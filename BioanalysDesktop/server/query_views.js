import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_PROJECT, sanitizeProjectId } from './domain.js';
import { assertFiguresPath, parseFigureList, decorateFigures } from './figures.js';
import { readLocalFigures } from './pull.js';
import {
  buildProjectListCommand, buildReadProjectMetaCommand, parseProjectList, parseProjectMeta,
} from './project.js';
import { runRemote } from './remote_exec.js';
import { shellQuote } from './proc.js';
/**
 * 解析 project 查询参数：缺省用默认项目；非法（含穿越字符）返回 null，调用方回 400。
 */
export function resolveProjectParam(url) {
  const raw = url.searchParams.get('project') || DEFAULT_PROJECT;
  return sanitizeProjectId(raw);
}

/**
 * 列出数据面全部项目（含元数据）。
 * 项目目录存在但缺 project.json 时也列出，meta=null，不假装它不存在。
 */
export function listProjectsWithMeta() {
  const listing = runRemote(buildProjectListCommand());
  const ids = parseProjectList(listing);
  return ids.map((id) => {
    const encoded = runRemote(buildReadProjectMetaCommand(id));
    let meta = null;
    if (encoded.trim()) {
      meta = parseProjectMeta(Buffer.from(encoded.trim(), 'base64').toString('utf8'));
    }
    return { projectId: id, meta };
  });
}

function readProjectMetaFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 列出仓库根 workspace/projects/ 下的本地项目。
 *
 * 只扫一层目录。目录名必须通过 sanitizeProjectId，符号链接与非目录条目一律跳过。
 * project.json 缺失或损坏时 meta=null，不把一个真实存在的目录藏掉。
 */
export function listLocalProjectsWithMeta({ repoRoot } = {}) {
  if (!repoRoot) return [];
  const projectsRoot = path.resolve(String(repoRoot), 'workspace/projects');
  let entries;
  try {
    entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const projectId = sanitizeProjectId(entry.name);
    if (!projectId) continue;
    const projectDir = path.resolve(projectsRoot, projectId);
    if (!projectDir.startsWith(projectsRoot + path.sep)) continue;
    projects.push({
      projectId,
      meta: readProjectMetaFile(path.join(projectDir, 'project.json')),
    });
  }
  projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
  return projects;
}

/**
 * 合并远端与本地项目列表。按 projectId 去重，远端优先保留 meta，
 * 本地只补充远端没有的项目。
 */
export function listAllProjectsWithMeta({ repoRoot } = {}) {
  const remoteProjects = listProjectsWithMeta();
  const localProjects = listLocalProjectsWithMeta({ repoRoot });
  const seen = new Set();
  const projects = [];
  for (const item of [...remoteProjects, ...localProjects]) {
    const projectId = String(item?.projectId || '').trim();
    if (!projectId || seen.has(projectId)) continue;
    seen.add(projectId);
    projects.push(item);
  }
  return projects;
}

/**
 * 列出一个项目某条线 figures/ 下的图件（含中文说明），供 API 与后端预览页共用。
 *
 * 优先读本地回搬副本 outputs/<项目>/<线>/figures/（规范要求图件回搬本地），
 * 本地没有时才回落远端实时读取，并用 source 字段标明来源  -  -  不能让
 * "本地还没回搬"被误读成"这条线没出图"。
 */
export function listFiguresForLine(projectId, lineId) {
  const guard = assertFiguresPath(projectId, lineId);
  if (!guard.ok) {
    return { blocked: true, reason: guard.reason, figures: [] };
  }
  const local = readLocalFigures(projectId, lineId);
  if (local) {
    return {
      blocked: false,
      dir: local.dir,
      source: 'local',
      figures: decorateFigures(parseFigureList(
        local.figures.map((f) => `${f.name}|${f.size}|${f.mtime}`).join('\n')
      )),
    };
  }
  // guard.dir 由 assertFiguresPath 拼出，上游是 project/line 参数；引号闭合权不能留给调用方
  const probe = runRemote(`if [ -d ${shellQuote(guard.dir)} ]; then echo EXISTS; else echo MISSING; fi`);
  if (!probe.includes('EXISTS')) {
    return { blocked: true, reason: `图件目录不存在: ${guard.dir}`, figures: [] };
  }
  const listing = runRemote(
    `find ${shellQuote(guard.dir)} -maxdepth 1 -type f -printf '%f|%s|%T@\\n' 2>/dev/null`
  );
  return {
    blocked: false,
    dir: guard.dir,
    source: 'remote',
    figures: decorateFigures(parseFigureList(listing)),
  };
}
