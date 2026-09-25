"""cl-resolve.py <lines-file>: put a job's CHANGELOG lines back after merge.sh took main's CHANGELOG.md.
The file holds "### group" lines, each followed by the job's "- ..." line in that group. Each line
goes to the end of its group under "## Unreleased"; a group main does not have yet is added at the end."""
import sys
p = "CHANGELOG.md"
added = open(sys.argv[1]).read().splitlines()
lines = open(p).read().split("\n")
u = lines.index("## Unreleased")
end = next((i for i in range(u + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
group = None
for a in added:
    if a.startswith("### "):
        group = a
        continue
    if not a.startswith("- "):
        continue
    g = next((i for i in range(u, end) if lines[i] == group), None)
    if g is None:
        lines[end:end] = [group, a, ""]
        end += 3
        continue
    j = g + 1
    while j < end and lines[j].startswith("- "):
        j += 1
    lines.insert(j, a)
    end += 1
open(p, "w").write("\n".join(lines))
print("added", sum(a.startswith("- ") for a in added), "lines")
