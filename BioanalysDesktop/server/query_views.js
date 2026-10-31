import { DEFAULT_PROJECT, sanitizeProjectId } from './domain.js';
import { assertFiguresPath, parseFigureList, decorateFigures } from './figures.js';
import { readLocalFigures } from './pull.js';
import {
  buildProjectListCommand, buildReadProjectMetaCommand, parseProjectList, parseProjectMeta,
} from './project.js';
export function createQueryViews(runRemote) {
  /**
   * 解析 project 查询参数：缺省用默认项目；非法（含穿越字符）返回 null，调用方回 400。
   */
  function resolveProjectParam(url) {
    const raw = url.searchParams.get('project') || DEFAULT_PROJECT;
    return sanitizeProjectId(raw);
  }

  /**
   * 列出数据面全部项目（含元数据）。
   * 项目目录存在但缺 project.json 时也列出，meta=null，不假装它不存在。
   */
  function listProjectsWithMeta() {
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

  /**
   * 列出一个项目某条线 figures/ 下的图件（含中文说明），供 API 与后端预览页共用。
   *
   * 优先读本地回搬副本 outputs/<项目>/<线>/figures/（规范要求图件回搬本地），
   * 本地没有时才回落远端实时读取，并用 source 字段标明来源  -  -  不能让
   * "本地还没回搬"被误读成"这条线没出图"。
   */
  function listFiguresForLine(projectId, lineId) {
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
    const probe = runRemote(`if [ -d '${guard.dir}' ]; then echo EXISTS; else echo MISSING; fi`);
    if (!probe.includes('EXISTS')) {
      return { blocked: true, reason: `图件目录不存在: ${guard.dir}`, figures: [] };
    }
    const listing = runRemote(
      `find '${guard.dir}' -maxdepth 1 -type f -printf '%f|%s|%T@\\n' 2>/dev/null`
    );
    return {
      blocked: false,
      dir: guard.dir,
      source: 'remote',
      figures: decorateFigures(parseFigureList(listing)),
    };
  }
  return {
    resolveProjectParam,
    listProjectsWithMeta,
    listFiguresForLine,
  };
}
