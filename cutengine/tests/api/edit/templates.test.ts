import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../../src/server.js';
import { applyMergeFields } from '../../../src/template/merge.js';

describe('Template API', () => {
  let app: Awaited<ReturnType<typeof createServer>>;

  const sampleTemplate = {
    timeline: {
      tracks: [{
        clips: [{
          asset: { type: 'title', text: '{{TITLE}}' },
          start: 0,
          length: 5,
        }],
      }],
    },
    output: { format: 'mp4', resolution: 'hd' },
  };

  beforeAll(async () => {
    app = await createServer({ testing: true });
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. POST /edit/v1/template -> 201 + template id
  it('POST /edit/v1/template returns 201 with template id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/edit/v1/template',
      payload: { name: 'Test Template', template: sampleTemplate },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBeDefined();
    expect(body.response.name).toBe('Test Template');
    expect(body.response.version).toBe(1);
  });

  // 2. GET /edit/v1/template -> 200 + array
  it('GET /edit/v1/template returns 200 with array of templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/edit/v1/template' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.response)).toBe(true);
    expect(body.response.length).toBeGreaterThan(0);
  });

  // 3. GET /edit/v1/template/:id -> 200 + template details
  it('GET /edit/v1/template/:id returns 200 with template details', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/template',
      payload: { name: 'Detail Template', template: sampleTemplate },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({ method: 'GET', url: `/edit/v1/template/${id}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response.id).toBe(id);
    expect(body.response.name).toBe('Detail Template');
    expect(body.response.template).toBeDefined();
  });

  // 4. GET /edit/v1/template/:unknown -> 404
  it('GET /edit/v1/template/:unknown returns 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/edit/v1/template/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  // 5. PUT /edit/v1/template/:id -> 200 + updated (version incremented)
  it('PUT /edit/v1/template/:id returns 200 with updated template and version increment', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/template',
      payload: { name: 'Update Me', template: sampleTemplate },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/edit/v1/template/${id}`,
      payload: { name: 'Updated Name' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.response.name).toBe('Updated Name');
    expect(body.response.version).toBe(2);
  });

  // 6. DELETE /edit/v1/template/:id -> 200
  it('DELETE /edit/v1/template/:id returns 200', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/template',
      payload: { name: 'Delete Me', template: sampleTemplate },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({ method: 'DELETE', url: `/edit/v1/template/${id}` });
    expect(res.statusCode).toBe(200);

    // Verify it's gone
    const getRes = await app.inject({ method: 'GET', url: `/edit/v1/template/${id}` });
    expect(getRes.statusCode).toBe(404);
  });

  // 7. POST /edit/v1/template/:id/render -> 201 + render id (merge fields applied)
  it('POST /edit/v1/template/:id/render returns 201 with render id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/edit/v1/template',
      payload: { name: 'Render Template', template: sampleTemplate },
    });
    const { response: { id } } = JSON.parse(createRes.body);

    const res = await app.inject({
      method: 'POST',
      url: `/edit/v1/template/${id}/render`,
      payload: {
        merge: [
          { find: 'TITLE', replace: 'My Video' },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.response.id).toBeDefined();
    expect(body.response.status).toBe('queued');
  });
});

describe('applyMergeFields', () => {
  // 8. {{TITLE}} replaced correctly
  it('replaces {{TITLE}} correctly', () => {
    const input = '{"text": "{{TITLE}}"}';
    const result = applyMergeFields(input, [{ find: 'TITLE', replace: 'My Video' }]);
    expect(result).toBe('{"text": "My Video"}');
  });

  // 9. Multiple fields replaced
  it('replaces multiple fields', () => {
    const input = '{"title": "{{TITLE}}", "name": "{{NAME}}"}';
    const result = applyMergeFields(input, [
      { find: 'TITLE', replace: 'My Video' },
      { find: 'NAME', replace: 'John' },
    ]);
    expect(result).toBe('{"title": "My Video", "name": "John"}');
  });

  // 10. No fields -> unchanged
  it('returns unchanged string when no fields provided', () => {
    const input = '{"text": "Hello World"}';
    const result = applyMergeFields(input, []);
    expect(result).toBe(input);
  });
});
