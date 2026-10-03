import crypto from 'node:crypto';

export function createLocalSecurity(port = 4318) {
  const token = crypto.randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set(['http://127.0.0.1:4317', 'http://localhost:4317', ...[...hosts].map((host) => `http://${host}`)]);
  return {
    token,
    validate(req) {
      if (!hosts.has(req.headers.host)) return '非法本机 Host';
      if (req.headers.origin && !origins.has(req.headers.origin)) return '不允许来自其他网页的请求';
      if (req.headers['sec-fetch-site'] === 'cross-site' && !origins.has(req.headers.origin)) return '不允许跨站访问私人素材';
      if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) {
        if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return '写请求必须使用 application/json';
        if (req.headers['x-ai-cos-token'] !== token) return '本机会话已更新，请刷新后再试';
      }
      return null;
    },
  };
}
