/**
 * 用户端 portal · 参考文献上传 → 打印报告表格 端到端验证探针
 *
 * 目的：验证第 5 步打印/存为 PDF 时「六、参考文献」章节能列出
 *       序号 / 文件名 / 大小 / 收件箱内相对路径 四列，且路径是服务端真实落盘的文件。
 *       此前该表格只有「未上传参考文献」占位（0 篇）被验证过，有内容的分支未端到端实测。
 *
 * 为什么要在独立副本里跑：serve.mjs 的 INBOX 由 `new URL('./inbox/', import.meta.url)`
 * 决定，不可用环境变量隔离（硬编码）。直接测 8080 会往用户真实收件箱 portal/inbox/ 里
 * 写 refs/ 目录与文件。因此复制一份 portal 到临时目录，起独立端口，用完连目录一起删。
 *
 * 复现步骤（bash，工作区根目录）：
 *   1) mkdir -p cn_debug/portal_ref_probe
 *      cp portal/index.html portal/serve.mjs cn_debug/portal_ref_probe/
 *   2) PORTAL_PORT=8081 node cn_debug/portal_ref_probe/serve.mjs   # 后台起
 *      curl http://127.0.0.1:8081/health                                # 确认 inbox 指向临时目录
 *   3) 打开 http://127.0.0.1:8081/ ，把下面 IIFE 粘进控制台（或经 CDP evaluate 执行）
 *      断言 refRows 为「表头 + N 行真实 refs/<sid>/<文件名>」
 *   4) 清理：杀掉 8081 监听进程、关标签页、删除 cn_debug/portal_ref_probe/ 整个目录
 *
 * 说明：文件用 DataTransfer 合成后赋给 `#f-refs`（浏览器的文件选择框无法被自动化点击），
 *       但字节仍走真实的 POST /api/references → 真实落盘。扩展名/大小/同名不覆盖等
 *       服务端逻辑都会真实触发。
 */
(function () {
  // 两篇不同扩展名、不同大小的假文献（内容为探针文本，非真实文献）
  var mk = function (name, text) { return new File([text], name, { type: '' }); };
  var fileA = mk('ref_sample_a.md', '# 探针参考文献 A\n用于打印表格端到端实测。\n' + new Array(200).join('x'));
  var fileB = mk('ref_sample_b.txt', '探针参考文献 B\n第二篇，用于多篇排序与换行验证。\n' + new Array(80).join('y'));

  var dt = new DataTransfer();
  dt.items.add(fileA);
  dt.items.add(fileB);

  var input = document.getElementById('f-refs');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // 上传是 fetch 链（串行逐篇），等落盘 + renderRefs 完成后再读打印报告
  var waitUp = new Promise(function (resolve) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      var list = document.getElementById('ref-list');
      var msg = document.getElementById('e-refs');
      var settled = list && list.children.length >= 2 &&
        msg && /已上传|上传失败/.test(msg.textContent);
      if (settled || tries > 60) { clearInterval(timer); resolve(); }
    }, 100);
  });

  return waitUp.then(function () {
    // 拦 window.print，走真实 #btn-print 点击路径，再读报告
    window.print = function () { window.dispatchEvent(new Event('beforeprint')); };
    document.getElementById('print-report').innerHTML = '';
    document.getElementById('btn-print').click();

    var rep = document.getElementById('print-report');
    var refHead = Array.prototype.slice.call(rep.querySelectorAll('.pr-h'))
      .filter(function (h) { return h.textContent.indexOf('参考文献') >= 0; })[0];
    var sec = refHead ? refHead.parentElement : null;
    var table = sec ? sec.querySelector('table.pr-t') : null;
    var rows = table ? Array.prototype.slice.call(table.rows).map(function (r) {
      return Array.prototype.slice.call(r.cells).map(function (c) { return c.textContent.trim(); });
    }) : null;
    var txt = rep.textContent;

    return {
      refListItems: document.getElementById('ref-list').children.length,
      refRows: rows,
      hasTwoRefs: txt.indexOf('ref_sample_a.md') >= 0 && txt.indexOf('ref_sample_b.txt') >= 0,
      hasRefsPath: /refs\/[0-9a-f-]{6,}\//.test(txt),
      refSectionText: sec ? sec.textContent : null,
      stampInBody: /生成时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(txt)
    };
  });
})();
