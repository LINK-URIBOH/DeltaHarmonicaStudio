const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { INSTALLER_ASSET, CHECKSUM_ASSET } = require('./release-files.cjs');

async function publishNightly({ request, upload, sha, runId, version, runUrl, builtAt }) {
  const current = async () => (await request('GET', '/git/ref/heads/master')).object.sha === sha;
  if (!await current()) return { skipped: true };
  const previous = await request('GET', '/releases/tags/nightly', undefined, true);
  const oldTag = await request('GET', '/git/ref/tags/nightly', undefined, true);
  const release = previous ?? await request('POST', '/releases', { tag_name: 'nightly', target_commitish: sha, name: '最新测试版', draft: true, prerelease: true, make_latest: 'false' });
  const pending = [], backups = [], replacements = [];
  let tagChanged = false;
  try {
    for (const name of [INSTALLER_ASSET, CHECKSUM_ASSET]) pending.push(await upload(release, name, `${name}.pending-${runId}`));
    if (!await current()) {
      for (const asset of pending) await request('DELETE', `/releases/assets/${asset.id}`);
      if (!previous) await request('DELETE', `/releases/${release.id}`);
      return { skipped: true };
    }
    for (const [index, name] of [INSTALLER_ASSET, CHECKSUM_ASSET].entries()) {
      const old = release.assets?.find(asset => asset.name === name);
      if (old) {
        await request('PATCH', `/releases/assets/${old.id}`, { name: `${name}.previous-${runId}` });
        backups.push(old);
      }
      await request('PATCH', `/releases/assets/${pending[index].id}`, { name });
      replacements.push(pending[index]);
    }
    // This is deliberately the dedicated nightly tag, never a version tag.
    if (oldTag) await request('PATCH', '/git/refs/tags/nightly', { sha, force: true });
    else await request('POST', '/git/refs', { ref: 'refs/tags/nightly', sha });
    tagChanged = true;
    const body = `主分支自动构建的 Windows x64 测试版。\n\n- 程序版本：${version}\n- 提交：${sha}\n- 构建时间（UTC）：${builtAt}\n- [构建记录](${runUrl})\n\n下载 ${INSTALLER_ASSET} 安装；SHA256SUMS.txt 可用于校验文件。\n安装向导支持选择目录，并可在开始安装前取消。`;
    await request('PATCH', `/releases/${release.id}`, { name: '最新测试版', body, draft: false, prerelease: true, make_latest: 'false' });
  } catch (error) {
    // Restore the previous download names if upload, replacement or metadata fails.
    const rollbackErrors = [];
    const restore = async (action) => { try { await action(); } catch (failure) { rollbackErrors.push(failure); } };
    for (const asset of [...replacements, ...pending.filter(asset => !replacements.includes(asset))]) await restore(() => request('DELETE', `/releases/assets/${asset.id}`));
    for (const asset of backups) await restore(() => request('PATCH', `/releases/assets/${asset.id}`, { name: asset.name }));
    if (tagChanged) await restore(() => oldTag ? request('PATCH', '/git/refs/tags/nightly', { sha: oldTag.object.sha, force: true }) : request('DELETE', '/git/refs/tags/nightly'));
    if (!previous) await restore(() => request('DELETE', `/releases/${release.id}`));
    else await restore(() => request('PATCH', `/releases/${release.id}`, { name: previous.name, body: previous.body ?? '', draft: previous.draft, prerelease: previous.prerelease }));
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '测试版发布失败，回滚未完全成功，请查看日志');
    throw error;
  }
  // Release is already valid; old backup cleanup must not roll it back.
  for (const asset of backups) {
    try { await request('DELETE', `/releases/assets/${asset.id}`); }
    catch { console.warn(`旧附件 ${asset.id} 清理失败，当前下载不受影响`); }
  }
  return { skipped: false, releaseId: release.id };
}

async function main() {
  const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_REF } = process.env;
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_RUN_ID || GITHUB_REF !== 'refs/heads/master') throw new Error('只能在已授权的 master 构建中发布');
  const root = path.resolve(__dirname, '..');
  const folder = path.join(root, 'release', 'nightly');
  const installer = fs.readFileSync(path.join(folder, INSTALLER_ASSET));
  const digest = crypto.createHash('sha256').update(installer).digest('hex');
  if (installer.subarray(0, 2).toString() !== 'MZ' || fs.readFileSync(path.join(folder, CHECKSUM_ASSET), 'utf8') !== `${digest}  ${INSTALLER_ASSET}\n`) throw new Error('测试版安装包校验失败');
  const apiRoot = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;
  const send = async (method, url, body, optional = false, binary = false) => {
    const response = await fetch(url, {
      method, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': binary ? 'application/octet-stream' : 'application/json' },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body), signal: AbortSignal.timeout(binary ? 180000 : 30000)
    });
    if (optional && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} 请求失败（HTTP ${response.status}）`);
    return response.status === 204 ? null : response.json();
  };
  const request = (method, endpoint, body, optional) => send(method, `${apiRoot}${endpoint}`, body, optional);
  const upload = (release, name, pendingName) => {
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    if (url.origin !== 'https://uploads.github.com') throw new Error('不支持的附件上传地址');
    url.searchParams.set('name', pendingName);
    return send('POST', url, fs.readFileSync(path.join(folder, name)), false, true);
  };
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const result = await publishNightly({ request, upload, sha: GITHUB_SHA, runId: `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`, version, builtAt: new Date().toISOString(), runUrl: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` });
  console.log(result.skipped ? 'master 已有更新的提交，跳过过期构建发布。' : '固定测试版发布成功。');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.skipped ? '已跳过过期构建。\n' : `测试版：[下载页面](https://github.com/${GITHUB_REPOSITORY}/releases/tag/nightly)\n`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { publishNightly };
