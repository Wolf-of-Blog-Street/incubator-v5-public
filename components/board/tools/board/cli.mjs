import { createBoardClient } from '../client.mjs';
import {
  parseArgs,
  findDefaultDb,
  STATUS_ICONS,
  extractMilestonesFromDoc,
  printHelp
} from './parser.mjs';
import {
  handleTaskAdd,
  handleBugAdd,
  handleTaskSet,
  handleTaskRm
} from './taskCommands.mjs';
import {
  handleSyncDoc,
  handleFinishDoc,
  handleReopenDoc
} from './docCommands.mjs';
import { handleList } from './reportCommands.mjs';

/**
 * Main command router for board CLI.
 */
export async function runCli(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed._[0] || 'list';
  const projectName = parsed.flags.project || process.env.BOARD_PROJECT || null;
  const url = parsed.flags.url || process.env.FALCON_BOARD_URL || null;
  const token = parsed.flags.token || process.env.FALCON_BOARD_TOKEN || null;
  const dbPath = parsed.flags.db || findDefaultDb(projectName);
  const agentId = parsed.flags.agent || process.env.FALCON_AGENT_ID || null;
  const isExplicitDb = Boolean(parsed.flags.db) && !parsed.flags.url;

  const board = createBoardClient({
    url: isExplicitDb ? null : url,
    token,
    dbPath,
    agentId,
    project: projectName,
    local: isExplicitDb
  });

  try {
    switch (command) {
      case 'add':
        await handleTaskAdd(board, parsed);
        break;

      case 'bug':
        await handleBugAdd(board, parsed);
        break;

      case 'sync-doc':
        await handleSyncDoc(board, parsed, projectName, extractMilestonesFromDoc);
        break;

      case 'close-doc':
      case 'finish-doc':
        await handleFinishDoc(board, parsed, projectName);
        break;

      case 'open-doc':
      case 'reopen-doc':
        await handleReopenDoc(board, parsed, projectName);
        break;


      case 'set':
        await handleTaskSet(board, parsed);
        break;

      case 'rm':
        await handleTaskRm(board, parsed);
        break;

      case 'list':
        await handleList(board, parsed, STATUS_ICONS);
        break;

      case 'help':
      default:
        printHelp();
        break;
    }
  } finally {
    board.close();
  }
}
