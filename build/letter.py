# Monthly ward email: one issue per ward, written to docs/letter/latest.json for the Apps Script that sends it.
# Changes (new, moved, removed cameras; status changes) are measured against the camera snapshot taken when the previous
# data month arrived (data/letter_state.json). The script fills {{INTRO}} (welcome line or nothing) and {{UNSUB}}.
import json, math, datetime as dt, html as _h

FL = {'spd': 100, 'red': 150, 'stp': 100, 'trk': 0}   # lowest fine per type, as on the map
KINDS = {'spd': 'speed', 'red': 'red light', 'stp': 'stop sign', 'trk': 'truck restriction'}
WARDS = [str(w) for w in range(1, 9)]
ORD = {1: '1st', 2: '2nd', 3: '3rd'}
E = _h.escape
# the map's own tokens: ink, secondary ink, muted, hairline, red ink (buttons), link blue, page grey, accent red
INK, INK2, MUTED, HAIR, RED, BLUE, BG, ACC = '#111418', '#4a5159', '#666e77', '#dde0e3', '#c2491a', '#226ac2', '#f3f4f5', '#eb6834'
DOT = {'spd': '#2a78d6', 'red': '#eb6834', 'stp': '#1baf7a', 'trk': '#52514e', 'unv': '#c99a06'}
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "'SF Mono',Menlo,Consolas,monospace"


def usd(v): return f'${v / 1e6:.1f}M' if v >= 1e6 else f'${round(v / 1e3)}k'
def mname(ym, full=True): return dt.date(int(ym[:4]), int(ym[5:]), 1).strftime('%B %Y' if full else '%B')
def cap(s): return s[:1].upper() + s[1:]
def pct(a, b):
    if not b: return ''
    p = round(100 * (a - b) / b)
    return '±0%' if p == 0 else f'{"+" if p > 0 else "−"}{abs(p)}%'
def ordinal(n): return ORD.get(n, f'{n}th')


def build(recs, cor, months, fetched, site, docs, data, slugof):
    cur = months[-1]
    snap = {c['id']: [c['x'], c['y'], c['s'], str(c['ward']), c['loc'], c['t']] for c in recs}
    path = data / 'letter_state.json'
    if path.exists(): state = json.load(open(path))
    else:   # first run: as if this data month arrived on the 12th of the following month
        nxt = dt.date(int(cur[:4]) + (cur[5:] == '12'), int(cur[5:]) % 12 + 1, 12)
        state = dict(month=cur, rolled=nxt.isoformat(), cams=snap, prev=None)
    if state['month'] != cur:
        state = dict(month=cur, rolled=fetched.isoformat(), cams=snap, prev=dict(month=state['month'], rolled=state['rolled'], cams=state['cams']))
    state['cams'] = snap
    path.write_text(json.dumps(state, separators=(',', ':')) + '\n')
    prev = state['prev']
    since = prev['rolled'] if prev else state['rolled']

    site_url = site['site_url'].rstrip('/') + '/'
    url = lambda cid: f'{site_url}c/{cid.replace(" ", "").lower()}/'
    real = [c for c in recs if c['s'] != 'unv']
    last, before = mname(cur), mname(months[-2], False)
    tot = {w: sum(c['m'][-1] for c in real if str(c['ward']) == w) for w in WARDS}
    order = sorted(WARDS, key=lambda w: -tot[w])

    # what changed, per ward: (tag, location, type)
    news = {w: [] for w in WARDS}
    credited = {o.camera_id for o in cor.itertuples() if (o.added or '') > since}
    if prev:
        old = prev['cams']
        for cid, (x, y, s, w, loc, t) in snap.items():
            if cid not in old:
                news[w].append(('Reported' if s == 'unv' else 'New', loc, 'unv' if s == 'unv' else t, cid)); continue
            ox, oy, os_ = old[cid][:3]
            if os_ != s and s == 'live': news[w].append(('Now ticketing', loc, t, cid))
            elif os_ != s and s == 'warn': news[w].append(('Warning period', loc, t, cid))
            elif os_ == 'unv' and s != 'unv': news[w].append(('Confirmed', loc, t, cid))
            if cid not in credited and math.hypot(x - ox, y - oy) * 1609.344 / 100 > 50: news[w].append(('Moved', loc, t, cid))
        for cid, (x, y, s, w, loc, t) in old.items():
            if cid not in snap: news[w].append(('Removed', loc, t, None))
    by_id = {c['id']: c for c in recs}
    thanks = [(by_id[o.camera_id], {'move': 'moved', 'include': 'added', 'report': 'reported'}.get(o.action, 'fixed'), o.credit.rstrip('.'))
              for o in cor.itertuples() if o.camera_id in credited and o.camera_id in by_id]

    city, city_b = sum(tot.values()), sum(c['m'][-2] for c in real)
    city_usd = sum(c['m'][-1] * FL[c['t']] for c in real)
    monthly, manage = site.get('supporter_url'), site.get('supporter_manage')
    sp = data / 'supporters.csv'   # monthly supporters who typed a name for the thanks line (first name + initial)
    backers = [l.split(',')[0].strip() for l in sp.read_text().splitlines()[1:] if l.strip()] if sp.exists() else []

    # building blocks, inline-styled for mail clients
    lab = lambda t, top=26: f'<div style="margin:{top}px 0 8px;font:600 11px/1 {SANS};letter-spacing:.09em;text-transform:uppercase;color:{MUTED}">{t}</div>'
    dot = lambda t: f'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:{DOT[t]}"></span>'
    tag = lambda t: (f'<span style="display:inline-block;padding:2px 6px 1px;border:1px solid {HAIR};border-radius:3px;font:600 10px/1.4 {MONO};'
                     f'letter-spacing:.06em;text-transform:uppercase;color:{INK2};white-space:nowrap">{t}</span>')
    link = lambda cid, loc: f'<a href="{url(cid)}" style="color:{INK};text-decoration:none;font-weight:600">{E(loc)}</a>'
    def rows(items):   # items: (left cell html, main html, sub text, right html)
        out = ''
        for i, (l, main, sub, r) in enumerate(items):
            bt = f'border-top:1px solid {HAIR};' if i else ''
            out += (f'<tr><td style="{bt}padding:9px 10px 9px 0;width:14px;vertical-align:top;line-height:20px">{l}</td>'
                    f'<td style="{bt}padding:8px 0;vertical-align:top;font:400 15px/1.35 {SANS};color:{INK}">{main}'
                    + (f'<div style="font-size:13px;color:{MUTED};margin-top:1px">{sub}</div>' if sub else '') + '</td>'
                    f'<td style="{bt}padding:8px 0 8px 10px;vertical-align:top;text-align:right;white-space:nowrap;font:500 14px/1.35 {MONO};color:{INK2}">{r}</td></tr>')
        return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">{out}</table>'
    pills = ''.join(f'<a href="{E(a["url"])}" style="display:inline-block;margin:0 6px 6px 0;padding:8px 14px 7px;border:1.5px solid {RED};'
                    f'border-radius:999px;color:{RED};font:700 14px/1 {SANS};text-decoration:none">{E(a["label"])}</a>' for a in site.get('tip_amounts', []))

    issue = dict(id=cur, label=last, built=fetched.isoformat(), wards={})
    for w in WARDS:
        cs = [c for c in real if str(c['ward']) == w]
        n, nb, money = tot[w], sum(c['m'][-2] for c in cs), sum(c['m'][-1] * FL[c['t']] for c in cs)
        series = [sum(c['m'][i] for c in cs) for i in range(len(months))]
        rank = order.index(w) + 1
        top = sorted((c for c in cs if c['m'][-1]), key=lambda c: -c['m'][-1])[:3]
        newsloc = {x[1] for x in news[w]}
        heads = [c for c in cs if c['s'] == 'warn' and c['loc'] not in newsloc]
        subject = f'Last month in Ward {w}: {n:,} camera tickets'

        # header band: the map's dark hero, with a 12-month column chart (last month in the accent red)
        mx = max(series) or 1
        bars = ''.join(f'<td valign="bottom" style="padding:0 1px;height:64px"><div title="{mname(ym)}: {v:,} tickets" '
                       f'style="height:{max(2, round(60 * v / mx)) if v else 0}px;background:{ACC if i == len(series) - 1 else "#4b5259"};border-radius:3px 3px 0 0"></div></td>'
                       for i, (ym, v) in enumerate(zip(months, series)))
        ticks = ''.join(f'<td style="padding-top:5px;text-align:center;font:500 10px/1 {MONO};color:{"#ffffff" if i == len(months) - 1 else "#8a9199"}">'
                        f'{mname(ym, False)[0]}</td>' for i, ym in enumerate(months))
        stat = lambda big, small, pad='22px': (f'<td style="padding:0 {pad} 0 0;vertical-align:bottom"><div style="font:800 30px/1 {SANS};color:#ffffff;letter-spacing:-.02em">{big}</div>'
                                               f'<div style="margin-top:6px;font:600 10px/1 {MONO};letter-spacing:.09em;text-transform:uppercase;color:#9aa1a8">{small}</div></td>')
        band = (f'<div style="background:{INK};border-radius:8px;padding:20px 20px 16px;color:#ffffff">'
                f'<div style="font:600 11px/1 {MONO};letter-spacing:.12em;text-transform:uppercase;color:{ACC}">DC Traffic Cameras · Ward {w}</div>'
                f'<div style="margin:8px 0 16px;font:800 24px/1.15 {SANS};color:#ffffff">Last month in Ward {w}</div>'
                '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>'
                + stat(f'{n:,}', 'tickets') + stat(usd(money), 'in fines') + stat(pct(n, nb), f'vs {before}', '0') + '</tr></table>'
                f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;table-layout:fixed">'
                f'<tr>{bars}</tr><tr>{ticks}</tr></table>'
                f'<div style="margin-top:10px;font:400 12px/1.4 {SANS};color:#9aa1a8">Tickets per month, {mname(months[0])} to {last}. '
                f'Ward {w} ranks {ordinal(rank)} of DC\'s 8 wards.</div></div>')

        parts = ['{{INTRO}}', band, lab('Busiest cameras'),
                 rows([(dot(c['t']), link(c['id'], c['loc']), f'{KINDS[c["t"]]} · ' + (E(c['hood']) if c['hood'].lower().startswith('near') else f'near {E(c["hood"])}'), f'{c["m"][-1]:,}') for c in top])]
        what = [(dot(t), link(cid, loc) if cid else f'<b>{E(loc)}</b>', None, tag(tg)) for tg, loc, t, cid in news[w]] + \
               [(dot(c['t']), link(c['id'], c['loc']), 'warning period: tickets start soon', tag('Heads-up')) for c in heads]
        if what: parts += [lab('What\'s new'), rows(what)]
        parts.append(f'<p style="margin:22px 0 0;font:400 14px/1.5 {SANS};color:{INK2}"><b style="color:{INK}">Citywide</b> &nbsp;'
                     f'<span style="font-family:{MONO}">{city:,}</span> tickets · <span style="font-family:{MONO}">{usd(city_usd)}</span> · '
                     f'<span style="font-family:{MONO}">{pct(city, city_b)}</span> vs {before}</p>')
        if thanks: parts += [lab('Fixed thanks to readers'), rows([(dot(c['t']), link(c['id'], c['loc']), f'thanks to {E(who)}', tag(how)) for c, how, who in thanks])]
        parts += [
            f'<p style="margin:14px 0 0;font:400 14px/1.5 {SANS};color:{INK2}">Missing or misplaced camera? Just reply to this email.</p>',
            f'<div style="margin:26px 0 0;padding:14px 16px 10px;border:1px solid {HAIR};border-left:3px solid {ACC};border-radius:6px">'
            f'<div style="font:600 11px/1 {MONO};letter-spacing:.12em;text-transform:uppercase;color:{RED}">Saved you a ticket?</div>'
            f'<p style="margin:8px 0 12px;font:600 15px/1.45 {SANS};color:{INK}">Please consider buying me a coffee ☕ to keep the map free and accessible to everyone.</p>{pills}'
            + (f'<p style="margin:4px 0 4px;font:400 13px/1.45 {SANS};color:{INK2}">Or <a href="{E(monthly)}" style="color:{RED}">chip in {E(site.get("supporter_label", "monthly"))}</a> to keep these emails coming. Cancel anytime.</p>' if monthly else '')
            + (f'<p style="margin:6px 0 4px;font:400 13px/1.45 {SANS};color:{INK2}">Kept going by {E(", ".join(backers))}. Thank you!</p>' if backers else '')
            + '</div>',
            f'<p style="margin:24px 0 0;font:400 14px/1.5 {SANS};color:{INK}">Drive safe,<br>DC Traffic Cameras Map Team<br>'
            f'<a href="{site_url}" style="color:{BLUE}">{site_url.split("//")[1].rstrip("/")}</a></p>',
        ]
        fine = (f'Last data: {last}. DDOT publishes each month\'s ticket counts around the 10th of the next month. Dollar figures use '
                f'the lowest fine for each camera type. You get this email because you signed up for Ward {w} on the map; to switch wards, '
                f'sign up again with the new one. <a href="{{{{UNSUB}}}}" style="color:{MUTED}">Unsubscribe</a>.'
                + (f' Monthly supporters can <a href="{E(manage)}" style="color:{MUTED}">cancel anytime here</a>.' if manage else ''))
        html = (f'<div style="background:{BG};padding:20px 10px"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid {HAIR};'
                f'border-radius:10px;padding:20px;font:400 15px/1.5 {SANS};color:{INK}">' + '\n'.join(parts) + '</div>'
                f'<p style="max-width:560px;margin:14px auto 0;font:400 11.5px/1.5 {SANS};color:{MUTED}">{fine}</p></div>')

        txt = ['{{INTRO}}', f'LAST MONTH IN WARD {w}', '', f'{n:,} tickets · {usd(money)} in fines · {pct(n, nb)} vs {before}',
               f'Ward {w} ranks {ordinal(rank)} of DC\'s 8 wards.', '', 'Busiest cameras:']
        txt += [f'- {c["loc"]} ({KINDS[c["t"]]}): {c["m"][-1]:,}  {url(c["id"])}' for c in top]
        if what: txt += ['', "What's new:"] + [f'- {tg}: {loc}' for tg, loc, t, cid in news[w]] + [f'- Heads-up, warning period: {c["loc"]}' for c in heads]
        txt += ['', f'Citywide: {city:,} tickets · {usd(city_usd)} · {pct(city, city_b)} vs {before}']
        if thanks: txt += ['', 'Fixed thanks to readers:'] + [f'- {c["loc"]} ({how}, thanks to {who})' for c, how, who in thanks]
        txt += ['', 'Missing or misplaced camera? Just reply to this email.', '',
                'Saved you a ticket? Please consider buying me a coffee ☕ to keep the map free and accessible to everyone:']
        txt += [f'{"Other amount" if a["label"] == "Other" else a["label"]}: {a["url"]}' for a in site.get('tip_amounts', [])]
        if monthly: txt += [f'Or chip in {site.get("supporter_label", "monthly")} to keep these emails coming (cancel anytime): {monthly}']
        if backers: txt += [f'Kept going by {", ".join(backers)}. Thank you!']
        txt += ['', 'Drive safe,', 'DC Traffic Cameras Map Team', site_url, '', '--',
                f'Last data: {last}. DDOT publishes each month\'s ticket counts around the 10th of the next month. Dollar figures use the lowest '
                f'fine for each camera type. You signed up for Ward {w} on the map; to switch wards, sign up again. To unsubscribe, reply with the word unsubscribe.'
                + (f' Monthly supporters can cancel anytime: {manage}' if manage else '')]
        issue['wards'][w] = dict(subject=subject, html=html, text='\n'.join(txt))
    out = docs / 'letter'; out.mkdir(exist_ok=True)
    (out / 'latest.json').write_text(json.dumps(issue, ensure_ascii=False, separators=(',', ':')))
    return issue, {w: len(news[w]) for w in WARDS}, len(thanks)
