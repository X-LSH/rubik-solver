/* 通过 GitHub API 推送本地提交（通道故障时的备选路径）
 * 关键：携带与本地提交一致的 tree/parent/author/committer/时间戳/文案，
 * 使远端生成【完全相同的 SHA】，避免本地与远端历史分叉。
 */
var cp = require('child_process');
function sh(cmd, opts) {
  var r = cp.spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('命令失败: ' + cmd + '\n' + r.stderr);
  return r.stdout;
}
function gh(method, path, body) {
  var args = ['api', '-X', method, path];
  var input = null;
  if (body !== undefined) { args.push('--input', '-'); input = JSON.stringify(body); }
  var r = cp.spawnSync('gh', args, { input: input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error('gh api ' + method + ' ' + path + ' 失败:\n' + r.stderr);
  return JSON.parse(r.stdout);
}

var LOCAL_FULL = sh('git rev-parse HEAD').trim();
var LOCAL_SHORT = LOCAL_FULL.slice(0, 7);
console.log('本地提交:', LOCAL_SHORT);

// ---- 解析本地提交对象（tree/parent/author/committer/message）----
var raw = sh('git cat-file commit ' + LOCAL_FULL);
var lines = raw.split('\n');
var meta = {}, i = 0;
while (lines[i] && lines[i].trim() !== '') {
  var m = lines[i].match(/^(\w+) (.*)$/);
  if (m) meta[m[1]] = m[2];
  i++;
}
var message = lines.slice(i + 1).join('\n');   // 空行之后的全部内容（含末尾换行）
var tree = meta.tree, parent = meta.parent;
var am = meta.author.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
var cm = meta.committer.match(/^(.*) <(.*)> (\d+) ([+-]\d{4})$/);
function isoDate(epoch, tz) {
  // 以提交里的时区偏移生成 ISO 串，保证 git 对象字节级一致
  var d = new Date((parseInt(epoch, 10) + (parseInt(tz, 10) / 100) * 3600) * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, tz[0] + tz.slice(1, 3) + ':' + tz.slice(3));
}
var authorDate = isoDate(am[3], am[4]);
console.log('tree:', tree.slice(0, 10), '| parent:', parent.slice(0, 10));
console.log('author:', am[1], '<' + am[2] + '>', authorDate);

// ---- 变更文件清单 ----
var files = sh('git diff-tree --no-commit-id --name-only -r ' + LOCAL_FULL).split('\n').filter(Boolean);
console.log('变更文件:', files.join(', '));

// ---- 1. 上传 blob（内容取自 git 对象库，保证字节一致）----
var entries = files.map(function (f) {
  var sha = sh('git rev-parse HEAD:' + JSON.stringify(f)).trim();
  var content = cp.execSync('git cat-file blob ' + sha, { maxBuffer: 64 * 1024 * 1024 });
  var b = gh('POST', 'repos/X-LSH/rubik-solver/git/blobs', { content: content.toString('base64'), encoding: 'base64' });
  if (b.sha !== sha) throw new Error(f + ' blob sha 不一致: 远端 ' + b.sha + ' vs 本地 ' + sha);
  console.log('  blob ok:', f, '→', sha.slice(0, 10));
  return { path: f, mode: '100644', type: 'blob', sha: sha };
});

// ---- 2. 建树（以父提交树为基底，校验与本地 tree 一致）----
var parentCommit = gh('GET', 'repos/X-LSH/rubik-solver/git/commits/' + parent);
var t = gh('POST', 'repos/X-LSH/rubik-solver/git/trees', { base_tree: parentCommit.tree.sha, tree: entries });
if (t.sha !== tree) throw new Error('tree sha 不一致: 远端 ' + t.sha + ' vs 本地 ' + tree);
console.log('  tree ok:', t.sha.slice(0, 10), '（与本地一致）');

// ---- 3. 建提交（字节级一致 → SHA 应与本地相同）----
var commit = gh('POST', 'repos/X-LSH/rubik-solver/git/commits', {
  message: message, tree: t.sha, parents: [parent],
  author: { name: am[1], email: am[2], date: authorDate },
  committer: { name: cm[1], email: cm[2], date: isoDate(cm[3], cm[4]) }
});
console.log('  远端生成提交:', commit.sha.slice(0, 7), '| 本地:', LOCAL_SHORT);
if (commit.sha !== LOCAL_FULL) {
  console.log('⚠ SHA 不一致（内容仍相同）。将以远端提交为准更新 ref，本地稍后对齐。');
}

// ---- 4. 更新 main 指向 ----
gh('PATCH', 'repos/X-LSH/rubik-solver/git/refs/heads/main', { sha: commit.sha, force: false });
console.log('  ref 已更新 →', commit.sha.slice(0, 7));

// ---- 5. 独立核实 ----
var head = gh('GET', 'repos/X-LSH/rubik-solver/commits/main');
console.log('');
console.log('=== 核实 ===');
console.log('远端 main:', head.sha.slice(0, 7), '|', head.commit.message.split('\n')[0]);
console.log(head.sha === LOCAL_FULL ? '✓ 与本地完全一致（无分叉）' : '⚠ 与本地 SHA 不同（内容一致），本地稍后需对齐远端');
