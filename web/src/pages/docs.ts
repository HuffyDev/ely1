import howItWorks from '../../../docs/how-it-works.md?raw';
import funding from '../../../docs/funding.md?raw';
import fundingSim from '../../../docs/funding-simulation.md?raw';
import indexMethod from '../../../docs/index-method.md?raw';
import trust from '../../../docs/trust.md?raw';
import threats from '../../../docs/THREAT_MODEL.md?raw';
import terms from '../../../docs/terms.md?raw';
import rules from '../../../docs/rules.md?raw';
import { state, esc } from '../lib';

const PAGES: Record<string, { title: string; md: () => string }> = {
  '': { title: 'How it works', md: () => howItWorks },
  index: { title: 'Index methodology', md: () => indexMethod },
  funding: { title: 'Funding & simulation', md: () => funding + '\n\n' + fundingSim.replace(/^# .*$/m, '## Simulation results') },
  trust: { title: 'What you trust', md: () => trust },
  threats: { title: 'Threat model', md: () => threats },
  contract: { title: 'Contract & network', md: contractPage },
};

function contractPage() {
  const c = state.cfg!;
  return `# Contract & network

| | |
|---|---|
| Network | ${c.chain.name} (chain id \`${c.chain.id}\`) |
| RPC | \`${c.chain.rpc}\` |
| Explorer | ${c.chain.explorer ? `[${c.chain.explorer}](${c.chain.explorer})` : '—'} |
| SlopxPools | ${c.contract ? `\`${c.contract}\`` : 'not deployed on this site yet'} |
| Index data chain | Elysium (chain id \`${c.dataChain.id}\`) |
| Uniswap v4 PoolManager | \`${c.dataChain.poolManager}\` |
| WHYPE | \`${c.dataChain.whype}\` |
| Verified launchpad labels | ${c.labels.filter((l) => l.hooks.length).map((l) => `${l.name} (${l.hooks.length} hook${l.hooks.length > 1 ? 's' : ''})`).join(', ') || 'none yet: launchpads are shown by hook address'} |
| Index method | \`${c.index.method}\` |
| Round length | ${state.timing ? state.timing.duration / 60 + ' min' : '—'} |
| Dispute window | ${state.timing ? state.timing.disputeWindow / 60 + ' min' : '—'} |
| Missing-result refund after | ${state.timing ? state.timing.maxPriceDelay / 3600 + ' h' : '—'} |

**Always check the contract address** against the GitHub README before depositing. SLOPX will never ask for your private key or seed phrase.`;
}

/** Tiny markdown renderer for our own trusted docs (headings, lists, tables, code, links, bold, raw html blocks). */
export function md(src: string): string {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  const inline = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}"${u.startsWith('http') ? ' target="_blank" rel="noopener"' : ''} class="up">${t}</a>`)
    .replace(/&lt;(\/?)(strong|em|br|a|span)([^&]*?)&gt;/g, (_m, sl, tag, rest) => `<${sl}${tag}${rest.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}>`).replace(/&amp;amp;/g, '&amp;');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith('```')) { const buf = []; i++; while (i < lines.length && !lines[i].startsWith('```')) buf.push(esc(lines[i++])); i++; out.push(`<pre><code>${buf.join('\n')}</code></pre>`); continue; }
    if (l.startsWith('<div')) { const buf = [l]; while (!lines[i].includes('</div>')) buf.push(lines[++i]); i++; out.push(buf.join('\n')); continue; }
    const h = l.match(/^(#{1,3}) (.*)/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = []; while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      const [head, , ...body] = rows;
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td style="white-space:normal">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ordered = /^\s*\d+\./.test(l); const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [l]; i++; while (i < lines.length && lines[i].trim() && !/^(#|\||```|\s*[-*] |\s*\d+\. |<div)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

export function renderDocs(root: HTMLElement, page = '') {
  const p = PAGES[page] ?? PAGES[''];
  root.innerHTML = `<div class="doc"><nav class="doc-nav">${Object.entries(PAGES).map(([k, v]) => `<a href="#/docs${k ? '/' + k : ''}" class="${k === page ? 'active' : ''}">${v.title}</a>`).join('')}
    <a href="#/trust">Rules &amp; Risk</a><a href="#/terms">Terms</a></nav><article class="prose">${md(p.md())}</article></div>`;
}

export function renderTerms(root: HTMLElement) {
  root.innerHTML = `<div class="doc"><nav class="doc-nav"><a href="#/trust">Rules &amp; Risk</a><a href="#/docs/trust">What you trust</a><a href="#/docs/threats">Threat model</a><a class="active" href="#/terms">Terms</a></nav><article class="prose">${md(terms)}</article></div>`;
}

export function renderTrust(root: HTMLElement) {
  const g = state.geo as any;
  const regions = `<div class="card card-pad" style="margin:16px 0">
    <div class="row between wrap"><strong>Blocked regions (live config)</strong><span class="small muted">set with <code>BLOCKED_REGIONS</code></span></div>
    <div class="row wrap mt" style="gap:6px">${(g?.blockedRegions ?? []).map((r: string) => `<span class="tag">${esc(r)}</span>`).join('') || '<span class="muted small">none configured</span>'}</div>
    <div class="small muted mt">Your detected region: <strong>${g?.country ? esc(g.country) : 'unknown (no country header from the host)'}</strong>${g?.blocked ? ' — deposits are blocked for you.' : ''}</div></div>`;
  const html = md(rules).replace(/(<h2>Regional blocking<\/h2>\s*<p>[\s\S]*?<\/p>)/, `$1${regions}`);
  root.innerHTML = `<div class="doc fade-in"><nav class="doc-nav"><a class="active" href="#/trust">Rules &amp; Risk</a><a href="#/docs/trust">What you trust</a><a href="#/docs/threats">Threat model</a><a href="#/terms">Terms</a></nav><article class="prose">${html}</article></div>`;
}
