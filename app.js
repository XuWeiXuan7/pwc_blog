/**
 * wxCode Blog - 纯静态版（GitHub Issues 作为 CMS）
 * 
 * 工作原理：
 * - 每一篇博客 = 一个 GitHub Issue
 * - 文章标题 = Issue 标题
 * - 文章内容 = Issue 正文（Markdown）
 * - 标签 = Issue 的 labels
 * - 发布日期 = Issue 创建时间
 * 
 * 发布博客：在 GitHub 仓库的 Issues 页面新建 Issue 即可
 */

// ============ 配置（请修改为你的 GitHub 用户名和仓库名） ============
const CONFIG = {
  githubUser: 'XuWeiXuan7', // 例: 'octocat'
  githubRepo: 'pwc_web', // 例: 'wxCode-blog'
  postLabel: 'blog' // 标记为文章的标签，只有带这个标签的 Issue 才会显示
};

// ============ GitHub API ============
const GITHUB_API = 'https://api.github.com';
// CORS 代理列表（按顺序尝试）
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url='
];

// 带 CORS 代理的 fetch
async function fetchWithProxy(url, retries = 2) {
  for (const proxy of CORS_PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(url);
      const res = await fetch(proxyUrl, {
        timeout: 10000
      });
      if (res.ok) return res;
    } catch (e) {
      console.warn(`Proxy ${proxy} failed:`, e);
      continue;
    }
  }
  // 如果所有代理都失败，尝试直接请求
  return fetch(url);
}

async function apiGetPosts() {
  const url = `${GITHUB_API}/repos/${CONFIG.githubUser}/${CONFIG.githubRepo}/issues?labels=${CONFIG.postLabel}&state=open&sort=created&per_page=100`;
  const res = await fetchWithProxy(url);
  if (!res.ok) throw new Error(`获取文章失败 (${res.status})，请检查仓库是否公开或 Issue 是否存在`);
  const issues = await res.json();

  // 过滤掉 PR（PR 也是 issue 的一种）
  return issues
    .filter(issue => !issue.pull_request)
    .map(issue => issueToPost(issue));
}

async function apiGetPost(number) {
  const url = `${GITHUB_API}/repos/${CONFIG.githubUser}/${CONFIG.githubRepo}/issues/${number}`;
  const res = await fetchWithProxy(url);
  if (!res.ok) return null;
  const issue = await res.json();
  if (issue.pull_request) return null;
  return issueToPost(issue);
}

function issueToPost(issue) {
  return {
    slug: issue.number,
    title: issue.title,
    date: issue.created_at.slice(0, 10),
    tags: issue.labels.map(l => l.name).filter(l => l !== CONFIG.postLabel),
    author: issue.user.login,
    authorAvatar: issue.user.avatar_url,
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
  return `https://github.com/${CONFIG.githubUser}/${CONFIG.githubRepo}/issues/new?labels=${encodeURIComponent(labels)}&template=blog-post.md&title=文章标题`;
}

function getEditIssueUrl(number) {
  return `https://github.com/${CONFIG.githubUser}/${CONFIG.githubRepo}/issues/${number}`;
}

function getRepoUrl() {
  return `https://github.com/${CONFIG.githubUser}/${CONFIG.githubRepo}`;
}

// 检查是否为默认配置
function isDefaultConfig() {
  return CONFIG.githubUser === 'your-github-username' || CONFIG.githubRepo === 'your-blog-repo';
}