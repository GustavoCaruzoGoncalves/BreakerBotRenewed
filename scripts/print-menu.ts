import { renderMenu } from '../src/lib/menu.js';
import { getCommands } from '../src/commands/registry.js';

await import('../src/router.js');

const isAdmin = process.argv.includes('--admin');
process.stdout.write(`${renderMenu(getCommands(), isAdmin)}\n`);
process.exit(0);
