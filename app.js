/**
 * wxCode Blog - 纯静态版（Gitee Issues 作为 CMS）
 * 
 * 工作原理：
 * - 每一篇博客 = 一个 Gitee Issue
 * - 文章标题 = Issue 标题
 * - 文章内容 = Issue 正文（Markdown）
 * - 标签 = Issue 的 labels
 * - 发布日期 = Issue 创建时间
 * 
 * 发布博客：在 Gitee 仓库的 Issues 页面新建 Issue 即可
 */

// ============ 配置（请修改为你的 Gitee 用户名和仓库名） ============
const CONFIG = {
  giteeUser: 'xu-weixuan7', // 你的 Gitee 用户名
  giteeRepo: 'pwc_blog',     // 你的 Gitee 仓库名
  postLabel: 'blog'          // 标记为文章的标签，只有带这个标签的 Issue 才会显示
};

// ============ Gitee API ============
const GITEE_API = 'https://gitee.com/api/v5';

// 获取 Gitee Access Token（解决匿名请求被限流 403 的问题）
// 用户可以在页面上设置 Token，也可以硬编码（不推荐，因为前端代码会公开）
function getGiteeToken() {
  try {
    return localStorage.getItem('gitee_token') || '';
  } catch (e) {
    return '';
  }
}

function setGiteeToken(token) {
  try {
    if (token) {
      localStorage.setItem('gitee_token', token);
    } else {
      localStorage.removeItem('gitee_token');
    }
  } catch (e) {}
}

// CORS 代理列表（按顺序尝试）
const CORS_PROXIES = [
  {
    name: 'corsproxy.io',
    build: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
  },
  {
    name: 'allorigins',
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  },
  {
    name: 'codetabs',
    build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  }
];

async function fetchGiteeJson(url, { method = 'GET', useToken = true } = {}) {
  // 构造带 token 的请求 URL（Gitee 使用 access_token 查询参数）
  const token = useToken ? getGiteeToken() : '';
  const sep = url.includes('?') ? '&' : '?';
  const finalUrl = token ? `${url}${sep}access_token=${encodeURIComponent(token)}` : url;

  // 构建代理列表：先直连，再依次尝试代理
  const attempts = [{ name: 'direct', url: finalUrl }].concat(
    CORS_PROXIES.map(p => ({ name: p.name, url: p.build(finalUrl) }))
  );

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      console.log(`[Gitee] 请求 (${attempt.name}):`, attempt.url);
      const res = await fetch(attempt.url, {
        method,
        headers: { 'Accept': 'application/json' }
      });
      const text = await res.text();
      console.log(`[Gitee] 响应 (${attempt.name}): HTTP ${res.status}`);

      if (res.ok) {
        try {
          return JSON.parse(text);
        } catch (e) {
          // 如果代理返回非 JSON（例如成功但返回 HTML），跳过
          lastErr = new Error(`响应格式错误（非 JSON）`);
          continue;
        }
      }

      // 非 2xx 的响应
      let msg = `HTTP ${res.status}`;
      try {
        const err = JSON.parse(text);
        if (err.message) msg += ': ' + err.message;
      } catch (e) {}
      // 附加 Rate Limit 信息（如果有）
      const rlLimit = res.headers.get('X-RateLimit-Limit');
      const rlRemain = res.headers.get('X-RateLimit-Remaining');
      if (rlRemain !== null) {
        msg += `（Rate: ${rlRemain}/${rlLimit}）`;
      }
      lastErr = new Error(msg);

      // 404/403 等客户端错误不需要换代理（除非是 CORS 问题，但这里 CORS 错误在 catch 中处理）
      if (res.status === 404 || res.status === 403 || res.status === 401 || res.status === 422) {
        // 但 403 可能是限流，值得尝试 token
        if (res.status === 403 && !token && attempt.name === 'direct') {
          continue;
        }
        throw lastErr;
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[Gitee] ${attempt.name} 失败:`, err.message);
    }
  }

  throw lastErr || new Error('所有请求方式均失败');
}

async function apiGetPosts() {
  const url = `${GITEE_API}/repos/${CONFIG.giteeUser}/${CONFIG.giteeRepo}/issues?labels=${encodeURIComponent(CONFIG.postLabel)}&state=open&sort=created&page=1&per_page=100`;
  const issues = await fetchGiteeJson(url);
  console.log('[Gitee] 解析成功，Issue 数量:', issues.length);
  return issues.map(issue => issueToPost(issue));
}

async function apiGetPost(number) {
  const url = `${GITEE_API}/repos/${CONFIG.giteeUser}/${CONFIG.giteeRepo}/issues/${number}`;
  try {
    const issue = await fetchGiteeJson(url);
    return issueToPost(issue);
  } catch (e) {
    return null;
  }
}

function issueToPost(issue) {
  return {
    slug: issue.number || issue.id,
    title: issue.title || '无标题',
    date: (issue.created_at || '').slice(0, 10),
    tags: issue.labels ? issue.labels.map(l => l.name).filter(l => l !== CONFIG.postLabel) : [],
    author: issue.user ? (issue.user.login || issue.user.name || '匿名') : '匿名',
    authorAvatar: issue.user ? issue.user.avatar_url : '',
    summary: (issue.body || '').replace(/<[^>]+>/g, '').replace(/[#>*`_\-*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150),
    content: issue.body || '（这篇文章暂无内容）'
  };
}

// ============ Markdown 解析 ============
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre><code class="language-${lang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      out.push(`<h${hMatch[1].length}>${inline(hMatch[2])}</h${hMatch[1].length}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\|?[\s-]+\|/.test(lines[i + 1])) {
      const headers = line.split('|').filter(c => c.trim() && !/^\s*-+/.test(c)).map(c => `<th>${inline(c.trim())}</th>`).join('');
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|')) {
        const cells = lines[i].split('|').filter((c, idx, a) => idx > 0 && idx < a.length - 1 && c.trim()).map(c => `<td>${inline(c.trim())}</td>`).join('');
        rows.push(`<tr>${cells}</tr>`);
        i++;
      }
      out.push(`<table><thead><tr>${headers}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() &&
      !/^#{1,6}\s+/.test(lines[i]) && !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) && !/^[-*+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      let content = para.join(' ');
      // 处理段落内容，保留 img 标签
      content = processParagraphContent(content);
      out.push(`<p>${content}</p>`);
    }
  }

  return out.join('\n');
}

function inline(text) {
  let t = text;
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${escapeHtml(c)}</code>`);
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return t;
}

// 处理段落内容，保留安全的 HTML 标签（如 img）
function processParagraphContent(content) {
  let t = content;
  // 保留已有的 img 标签
  const imgTags = [];
  t = t.replace(/<img[^>]+>/gi, (match) => {
    const id = `__IMG_TAG_${imgTags.length}__`;
    imgTags.push(match);
    return id;
  });

  // 处理其他 Markdown
  t = t
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  // 还原 img 标签
  imgTags.forEach((tag, idx) => {
    t = t.replace(`__IMG_TAG_${idx}__`, tag);
  });

  return t;
}

// ============ Toast ============
function showToast(message, type) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show ' + (type || '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ============ URL 生成 ============
function getNewIssueUrl() {
  const labels = [CONFIG.postLabel].join(',');
  return `https://gitee.com/${CONFIG.giteeUser}/${CONFIG.giteeRepo}/issues/new?labels=${encodeURIComponent(labels)}&title=文章标题`;
}

function getEditIssueUrl(number) {
  return `https://gitee.com/${CONFIG.giteeUser}/${CONFIG.giteeRepo}/issues/${number}`;
}

function getRepoUrl() {
  return `https://gitee.com/${CONFIG.giteeUser}/${CONFIG.giteeRepo}`;
}

// 检查是否为默认配置
function isDefaultConfig() {
  return CONFIG.giteeUser === '你的Gitee用户名' || CONFIG.giteeRepo === '你的仓库名';
}