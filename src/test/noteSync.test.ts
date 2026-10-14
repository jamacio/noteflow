import * as assert from 'assert';
import { conflictPath, hashContent, LocalNote, planSync, SyncStore } from '../noteSync';

suite('Note Sync', () => {
	const now = new Date('2026-10-14T12:00:00Z');
	const local = (content: string, modified = 1): LocalNote => ({ content, modified });
	const base = (notes: Record<string, string>) =>
		Object.fromEntries(Object.entries(notes).map(([notePath, content]) => [notePath, hashContent(content)]));

	test('a new machine merges both sides without deleting anything', () => {
		const actions = planSync({ 'a.md': local('A') }, { 'b.md': { content: 'B', updated: 1 } }, {}, now);
		assert.deepStrictEqual(actions, [
			{ kind: 'push', path: 'a.md', content: 'A', updated: 1 },
			{ kind: 'write', path: 'b.md', content: 'B' }
		]);
	});

	test('nothing to do when both sides match', () => {
		const actions = planSync({ 'a.md': local('A') }, { 'a.md': { content: 'A', updated: 1 } }, base({ 'a.md': 'A' }), now);
		assert.deepStrictEqual(actions, []);
	});

	test('an edit here is pushed, an edit elsewhere is written', () => {
		const remote: SyncStore = { 'a.md': { content: 'A', updated: 1 }, 'b.md': { content: 'B2', updated: 2 } };
		const actions = planSync({ 'a.md': local('A2', 5), 'b.md': local('B') }, remote, base({ 'a.md': 'A', 'b.md': 'B' }), now);
		assert.deepStrictEqual(actions, [
			{ kind: 'push', path: 'a.md', content: 'A2', updated: 5 },
			{ kind: 'write', path: 'b.md', content: 'B2' }
		]);
	});

	test('deletes travel both ways', () => {
		const remote: SyncStore = { 'a.md': { content: 'A', updated: 1 }, 'b.md': { deleted: true, updated: 2 } };
		const actions = planSync({ 'b.md': local('B') }, remote, base({ 'a.md': 'A', 'b.md': 'B' }), now);
		assert.deepStrictEqual(actions, [
			{ kind: 'delete', path: 'b.md' },
			{ kind: 'pushDelete', path: 'a.md' }
		]);
	});

	test('an edit wins over a delete', () => {
		const actions = planSync({ 'a.md': local('A2') }, { 'a.md': { deleted: true, updated: 2 } }, base({ 'a.md': 'A' }), now);
		assert.deepStrictEqual(actions, [{ kind: 'push', path: 'a.md', content: 'A2', updated: 1 }]);
	});

	test('edits on both sides keep the newest and a conflict copy of the other', () => {
		const copy = conflictPath('dir/a.md', now);
		assert.strictEqual(copy, 'dir/a (conflict 2026-10-14).md');
		const actions = planSync({ 'dir/a.md': local('mine', 1) }, { 'dir/a.md': { content: 'theirs', updated: 9 } }, base({ 'dir/a.md': 'A' }), now);
		assert.deepStrictEqual(actions, [
			{ kind: 'write', path: 'dir/a.md', content: 'theirs' },
			{ kind: 'write', path: copy, content: 'mine' },
			{ kind: 'push', path: copy, content: 'mine', updated: now.getTime() }
		]);
	});
});
