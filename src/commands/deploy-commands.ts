import { REST, Routes } from 'discord.js';
import { config as loadEnv } from 'dotenv';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Deploy' });
import { loadProjects } from '../config.js';
import { buildPromptCommand } from './prompt.js';
import { data as stopData } from './stop.js';
import { data as statusData } from './status.js';
import { data as historyData } from './history.js';
import { data as retryData } from './retry.js';

loadEnv();

const projects = loadProjects();

const commands = [
  buildPromptCommand(projects).toJSON(),
  stopData.toJSON(),
  statusData.toJSON(),
  historyData.toJSON(),
  retryData.toJSON(),
];

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !guildId || !clientId) {
  log.fatal('請設定 DISCORD_BOT_TOKEN、DISCORD_GUILD_ID、DISCORD_CLIENT_ID');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  log.info(`正在註冊 ${commands.length} 個指令...`);

  await rest.put(Routes.applicationGuildCommands(clientId!, guildId!), {
    body: commands,
  });

  log.info('指令註冊完成');
}

main().catch((error) => {
  log.error({ err: error }, '註冊失敗');
  process.exit(1);
});
