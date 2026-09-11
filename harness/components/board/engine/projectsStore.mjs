import fs from 'node:fs';
import path from 'node:path';

/**
 * Normalizes a string into a URL-friendly lowercase identifier slug.
 * @param {string} text 
 * @returns {string}
 */
export function slugify(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derives a project ID slug from a GitHub URL or repository name.
 * e.g. "https://github.com/org/my-app.git" -> "my-app"
 * @param {string} url 
 * @returns {string}
 */
export function deriveIdFromGithubUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const parts = cleaned.split('/');
  const last = parts[parts.length - 1];
  return slugify(last);
}

/**
 * Validates a GitHub repository URL format.
 * @param {string} url 
 * @returns {boolean}
 */
export function isValidGithubUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return /^(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?(\/.*)?$/i.test(trimmed)
    || /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/i.test(trimmed);
}

/**
 * Creates and manages a persistent JSON project catalog store.
 * 
 * @param {Object} [options={}]
 * @param {string} [options.filePath] Absolute or relative path to projects.json
 * @param {Array} [options.initialProjects] In-memory default projects if file missing
 * @returns {Object} Store instance
 */
export function createProjectsStore(options = {}) {
  const filePath = options.filePath 
    ? path.resolve(options.filePath)
    : path.resolve(process.cwd(), 'config/projects.json');

  let projectsMap = new Map();
  let initialized = false;
  let loadError = null;

  function load() {
    if (initialized) return;
    projectsMap.clear();
    loadError = null;

    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        const list = Array.isArray(data.projects) ? data.projects : [];
        for (const p of list) {
          if (p && p.id) {
            projectsMap.set(p.id, {
              id: String(p.id).trim(),
              name: String(p.name || p.id).trim(),
              github_url: String(p.github_url || '').trim(),
              description: String(p.description || '').trim(),
              tags: Array.isArray(p.tags) ? p.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [],
              created_at: p.created_at || new Date().toISOString(),
              updated_at: p.updated_at || new Date().toISOString()
            });
          }
        }
      } catch (err) {
        // If file cannot be parsed, record error to prevent silent data loss
        loadError = err;
        console.error(`[ProjectsStore] Warning: failed to parse ${filePath}:`, err.message);
      }
    } else if (Array.isArray(options.initialProjects)) {
      for (const p of options.initialProjects) {
        if (p && p.id) {
          projectsMap.set(p.id, {
            id: String(p.id).trim(),
            name: String(p.name || p.id).trim(),
            github_url: String(p.github_url || '').trim(),
            description: String(p.description || '').trim(),
            tags: Array.isArray(p.tags) ? p.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [],
            created_at: p.created_at || new Date().toISOString(),
            updated_at: p.updated_at || new Date().toISOString()
          });
        }
      }
    }

    initialized = true;
  }

  function persist() {
    load();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Safety guard: If original file existed and had a parse error, back it up before overwriting
    if (loadError && fs.existsSync(filePath)) {
      const corruptBackup = `${filePath}.corrupted.${Date.now()}`;
      try {
        fs.copyFileSync(filePath, corruptBackup);
        console.warn(`[ProjectsStore] Saved corrupted backup to ${corruptBackup} before overwriting catalog`);
      } catch (backupErr) {
        console.error(`[ProjectsStore] Failed to create corrupted backup:`, backupErr.message);
      }
      loadError = null;
    }

    const payload = {
      version: '1.0.0',
      projects: Array.from(projectsMap.values())
    };

    const tempFile = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
  }

  return {
    get filePath() {
      return filePath;
    },

    listProjects() {
      load();
      return Array.from(projectsMap.values()).map(p => ({ ...p, tags: [...p.tags] }));
    },

    getProject(id) {
      load();
      if (!id) return null;
      const found = projectsMap.get(String(id).trim());
      return found ? { ...found, tags: [...found.tags] } : null;
    },

    addProject({ id, name, github_url, description = '', tags = [] }) {
      load();
      if (!github_url || typeof github_url !== 'string' || !github_url.trim()) {
        throw new Error('GitHub repository URL is required');
      }

      const cleanUrl = github_url.trim();
      const derivedId = id ? slugify(id) : deriveIdFromGithubUrl(cleanUrl);
      if (!derivedId) {
        throw new Error('Could not derive a valid project ID slug from provided URL or name');
      }

      if (projectsMap.has(derivedId)) {
        throw new Error(`Project with ID "${derivedId}" already exists in catalog`);
      }

      const cleanName = (name && typeof name === 'string' && name.trim()) 
        ? name.trim() 
        : derivedId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const now = new Date().toISOString();
      const normalizedTags = Array.isArray(tags)
        ? tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
        : (typeof tags === 'string' ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);

      const newProject = {
        id: derivedId,
        name: cleanName,
        github_url: cleanUrl,
        description: typeof description === 'string' ? description.trim() : '',
        tags: normalizedTags,
        created_at: now,
        updated_at: now
      };

      projectsMap.set(derivedId, newProject);
      persist();
      return { ...newProject, tags: [...newProject.tags] };
    },

    updateProject(id, updates = {}) {
      load();
      if (!id) throw new Error('Project ID is required');
      const targetId = String(id).trim();
      const existing = projectsMap.get(targetId);
      if (!existing) {
        throw new Error(`Project "${targetId}" not found`);
      }

      if (updates.github_url !== undefined) {
        if (!updates.github_url || typeof updates.github_url !== 'string') {
          throw new Error('GitHub repository URL cannot be empty');
        }
        existing.github_url = updates.github_url.trim();
      }

      if (updates.name !== undefined) {
        if (!updates.name || typeof updates.name !== 'string') {
          throw new Error('Project name cannot be empty');
        }
        existing.name = updates.name.trim();
      }

      if (updates.description !== undefined) {
        existing.description = String(updates.description).trim();
      }

      if (updates.tags !== undefined) {
        existing.tags = Array.isArray(updates.tags)
          ? updates.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
          : (typeof updates.tags === 'string' ? updates.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);
      }

      existing.updated_at = new Date().toISOString();
      persist();
      return { ...existing, tags: [...existing.tags] };
    },

    deleteProject(id) {
      load();
      if (!id) return false;
      const targetId = String(id).trim();
      if (!projectsMap.has(targetId)) return false;
      projectsMap.delete(targetId);
      persist();
      return true;
    },

    reload() {
      initialized = false;
      load();
      return this.listProjects();
    }
  };
}
