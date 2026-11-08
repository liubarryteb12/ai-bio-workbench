#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { main } from './ed25519_tools.mjs';

// 客户端 CLI 委托同一个校验核：清单里的绝对路径与 .. 越界在任何文件读取前拒绝。
const args = process.argv.slice(2);
if (!args.includes('--verify')) args.push('--verify');
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = main(args);
