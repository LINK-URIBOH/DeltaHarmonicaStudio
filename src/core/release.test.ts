import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { publishNightly } = require('../../scripts/publish-nightly.cjs');
const { prepareRelease } = require('../../scripts/prepare-release.cjs');
const { installerPath, INSTALLER_ASSET, CHECKSUM_ASSET } = require('../../scripts/release-files.cjs');
const temporary: string[] = [];
afterEach(() => { for (const folder of temporary.splice(0)) fs.rmSync(folder, { recursive: true, force: true }); });

function fakeRemote(existing = true) {
  const assets = new Map<number, { id: number; name: string }>();
  if (existing) { assets.set(1, { id: 1, name: INSTALLER_ASSET }); assets.set(2, { id: 2, name: CHECKSUM_ASSET }); }
  const state = { head: 'current', tag: existing ? 'old' : null as string | null, release: existing, metadata: { name: 'old release', body: 'old body', draft: false, prerelease: true }, failUpload: false, failMetadata: false, changeAfterUpload: false, uploads: 0, writes: 0 };
  let nextId = 3;
  const request = async (method: string, endpoint: string, body?: any) => {
    if (method === 'GET' && endpoint === '/git/ref/heads/master') return { object: { sha: state.head } };
    if (method === 'GET' && endpoint === '/git/ref/tags/nightly') return state.tag ? { object: { sha: state.tag } } : null;
    if (method === 'GET') return state.release ? { id: 10, assets: [...assets.values()].map(x => ({ ...x })), ...state.metadata } : null;
    state.writes++;
    if (method === 'POST' && endpoint === '/releases') { state.release = true; state.metadata = { ...state.metadata, ...body }; return { id: 10, assets: [] }; }
    if (method === 'DELETE' && endpoint === '/releases/10') { state.release = false; return; }
    const assetId = Number(endpoint.split('/').at(-1));
    if (endpoint.startsWith('/releases/assets/')) {
      if (method === 'DELETE') assets.delete(assetId);
      else assets.get(assetId)!.name = body.name;
      return;
    }
    if (endpoint === '/releases/10') {
      if (state.failMetadata) { state.failMetadata = false; throw new Error('metadata failed'); }
      Object.assign(state.metadata, body); return;
    }
    state.tag = method === 'DELETE' ? null : body.sha;
  };
  const upload = async (_release: unknown, _name: string, pending: string) => {
    state.uploads++;
    if (state.failUpload && state.uploads === 2) throw new Error('upload failed');
    if (state.changeAfterUpload && state.uploads === 2) state.head = 'newer';
    const asset = { id: nextId++, name: pending }; assets.set(asset.id, asset); return { ...asset };
  };
  return { state, assets, run: () => publishNightly({ request, upload, sha: 'current', runId: '123-1', version: '1.2.3', runUrl: 'https://github.com/example/repo/actions/runs/123', builtAt: '2026-09-26T00:00:00Z' }) };
}

describe('Windows release pipeline', () => {
  it('derives installer paths from version and creates matching fixed-name checksums', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmonica-release-')); temporary.push(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3', build: { productName: '测试程序', directories: { output: 'release' } } }));
    fs.mkdirSync(path.join(root, 'release'));
    const binary = Buffer.from('MZ test installer'); fs.writeFileSync(installerPath(root), binary);
    const output = prepareRelease(root);
    expect(fs.readFileSync(path.join(output, INSTALLER_ASSET))).toEqual(binary);
    expect(fs.readFileSync(path.join(output, CHECKSUM_ASSET), 'utf8')).toBe(`${crypto.createHash('sha256').update(binary).digest('hex')}  ${INSTALLER_ASSET}\n`);
    fs.writeFileSync(installerPath(root), 'not executable'); expect(() => prepareRelease(root)).toThrow();
  });
  it.each([true, false])('creates or updates only the fixed prerelease (existing=%s)', async existing => {
    const remote = fakeRemote(existing); expect(await remote.run()).toEqual({ skipped: false, releaseId: 10 });
    expect(remote.state.tag).toBe('current'); expect(remote.state.metadata.draft).toBe(false); expect(remote.state.metadata.prerelease).toBe(true);
    expect(remote.state.metadata.body).toContain('1.2.3'); expect(remote.state.metadata.body).toContain('current');
    expect([...remote.assets.values()].map(x => x.name).sort()).toEqual([INSTALLER_ASSET, CHECKSUM_ASSET].sort());
  });
  it('skips outdated builds without touching the previous release', async () => {
    const remote = fakeRemote(); remote.state.head = 'newer'; expect(await remote.run()).toEqual({ skipped: true }); expect(remote.state.writes).toBe(0);
  });
  it('removes staging uploads when master changes during upload', async () => {
    const remote = fakeRemote(); remote.state.changeAfterUpload = true;
    expect(await remote.run()).toEqual({ skipped: true });
    expect(remote.state.tag).toBe('old'); expect(remote.state.metadata.body).toBe('old body');
    expect([...remote.assets.values()].map(x => x.name)).toEqual([INSTALLER_ASSET, CHECKSUM_ASSET]);
  });
  it('removes an unpublished first release when an upload fails', async () => {
    const remote = fakeRemote(false); remote.state.failUpload = true;
    await expect(remote.run()).rejects.toThrow('upload failed');
    expect(remote.state.release).toBe(false); expect(remote.state.tag).toBeNull(); expect(remote.assets.size).toBe(0);
  });
  it('preserves the previous assets and tag if the second upload fails', async () => {
    const remote = fakeRemote(); remote.state.failUpload = true; await expect(remote.run()).rejects.toThrow('upload failed');
    expect(remote.state.tag).toBe('old'); expect([...remote.assets.values()].map(x => x.name)).toEqual([INSTALLER_ASSET, CHECKSUM_ASSET]);
    expect(remote.state.metadata.body).toBe('old body');
  });
  it('rolls back attachments and tag if release metadata cannot be published', async () => {
    const remote = fakeRemote(); remote.state.failMetadata = true; await expect(remote.run()).rejects.toThrow('metadata failed');
    expect(remote.state.tag).toBe('old'); expect([...remote.assets.values()].map(x => x.name)).toEqual([INSTALLER_ASSET, CHECKSUM_ASSET]);
    expect(remote.state.metadata.body).toBe('old body');
  });
});
