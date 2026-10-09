# Monthly ward email: one issue per ward, written to docs/letter/latest.json for the Apps Script that sends it.
# Changes (new, moved, removed cameras; status changes) are measured against the camera snapshot taken when the previous
# data month arrived (data/letter_state.json). The script fills {{INTRO}} (welcome line or nothing) and {{UNSUB}}.
import json, math, datetime as dt, html as _h

FL = {'spd': 100, 'red': 150, 'stp': 100, 'trk': 0}   # lowest fine per type, as on the map
KINDS = {'spd': 'speed', 'red': 'red light', 'stp': 'stop sign', 'trk': 'truck restriction'}
WARDS = [str(w) for w in range(1, 9)]
ORD = {1: '1st', 2: '2nd', 3: '3rd'}
E = _h.escape
INK, INK2, MUTED, HAIR, RED, BLUE = '#111418', '#4a5159', '#666e77', '#dde0e3', '#c2491a', '#226ac2'
SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "'SF Mono',Menlo,Consolas,monospace"


def usd(v): return f'${v / 1e6:.1f}M' if v >= 1e6 else f'${round(v / 1e3)}k'
def mname(ym, full=True): return dt.date(int(ym[:4]), int(ym[5:]), 1).strftime('%B %Y' if full else '%B')
def cap(s): return s[:1].upper() + s[1:]
def change(a, b, prev):
    if not b: return ''
    p = round(100 * (a - b) / b)
    return f'about the same as {prev}' if p == 0 else f'{"up" if p > 0 else "down"} {abs(p)}% from {prev}'


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

    # what changed, per ward
    news = {w: [] for w in WARDS}
    credited = {o.camera_id for o in cor.itertuples() if (o.added or '') > since}
    if prev:
        old = prev['cams']
        for cid, (x, y, s, w, loc, t) in snap.items():
            if cid not in old:
                news[w].append(f'New on the map: {loc} ({KINDS[t]}, ' + ('reported by readers, being checked' if s == 'unv' else
                               {'live': 'already ticketing', 'warn': 'warning period', 'soon': 'not live yet'}[s]) + ')')
                continue
            ox, oy, os_ = old[cid][:3]
            if os_ != s and s == 'live': news[w].append(f'Now ticketing: {loc} ({KINDS[t]})')
            elif os_ != s and s == 'warn': news[w].append(f'Warning period started, tickets follow in about 30 days: {loc} ({KINDS[t]})')
            elif os_ == 'unv' and s != 'unv': news[w].append(f'Confirmed by DDOT: {loc} ({KINDS[t]})')
            if cid not in credited and math.hypot(x - ox, y - oy) * 1609.344 / 100 > 50: news[w].append(f'Moved to a new spot: {loc}')
        for cid, (x, y, s, w, loc, t) in old.items():
            if cid not in snap: news[w].append(f'Removed from DDOT\'s list: {loc} ({KINDS[t]})')
    by_id = {c['id']: c for c in recs}
    thanks = []
    for o in cor.itertuples():
        if o.camera_id not in credited or o.camera_id not in by_id: continue
        loc, who = by_id[o.camera_id]['loc'], o.credit.rstrip('.')
        thanks.append({'move': f'{loc}: moved to the spot DDOT describes, thanks to {who}.',
                       'include': f'{loc}: added to the map, thanks to {who}.',
                       'report': f'{loc}: shown as reported, under verification, thanks to {who}.'}.get(o.action, f'{loc}: fixed thanks to {who}.'))

    city, city_b = sum(tot.values()), sum(c['m'][-2] for c in real)
    city_usd = sum(c['m'][-1] * FL[c['t']] for c in real)
    pills = ''.join(f'<a href="{E(a["url"])}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 13px;border:1.5px solid {RED};'
                    f'border-radius:999px;color:{RED};font:700 14px/1 {SANS};text-decoration:none">{E(a["label"])}</a>' for a in site.get('tip_amounts', []))
    monthly, manage = site.get('supporter_url'), site.get('supporter_manage')
    sp = data / 'supporters.csv'   # monthly supporters who typed a name for the thanks line (first name + initial)
    backers = [l.split(',')[0].strip() for l in sp.read_text().splitlines()[1:] if l.strip()] if sp.exists() else []
    issue = dict(id=cur, label=last, built=fetched.isoformat(), wards={})
    for w in WARDS:
        cs = [c for c in real if str(c['ward']) == w]
        n, nb, money = tot[w], sum(c['m'][-2] for c in cs), sum(c['m'][-1] * FL[c['t']] for c in cs)
        rank = order.index(w) + 1
        top = sorted((c for c in cs if c['m'][-1]), key=lambda c: -c['m'][-1])[:3]
        heads = [c for c in cs if c['s'] == 'warn' and f'{c["loc"]}' not in ' '.join(news[w])]
        subject = f'Last month in Ward {w}: {n:,} camera tickets'
        h2 = lambda t: f'<h2 style="margin:22px 0 6px;font:700 15px/1.3 {SANS};color:{INK}">{t}</h2>'
        li = lambda items: ('<ul style="margin:0;padding-left:18px;color:' + INK2 + '">' +
                            ''.join(f'<li style="margin:0 0 4px">{x}</li>' for x in items) + '</ul>')
        rank_txt = f'Ward {w} had the most camera tickets of DC\'s 8 wards.' if rank == 1 else f'Ward {w} ranked {ORD.get(rank, f"{rank}th")} of DC\'s 8 wards for camera tickets.'
        cell = lambda big, small: (f'<td style="padding:0 14px 0 0;vertical-align:top"><div style="font:800 24px/1.1 {SANS};color:{INK}">{big}</div>'
                                   f'<div style="font:600 11px/1.3 {MONO};letter-spacing:.06em;text-transform:uppercase;color:{MUTED};margin-top:3px">{small}</div></td>')
        body = [
            '{{INTRO}}',
            f'<div style="font:600 11px/1 {MONO};letter-spacing:.14em;text-transform:uppercase;color:{RED}">DC Traffic Cameras · Ward {w}</div>',
            f'<h1 style="margin:8px 0 14px;font:800 26px/1.15 {SANS};color:{INK}">Last month in Ward {w}</h1>',
            '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>'
            + cell(f'{n:,}', 'tickets') + cell(usd(money), 'in fines') + '</tr></table>',
            f'<p style="margin:12px 0 0;color:{INK2}">{cap(change(n, nb, before))}. {rank_txt}</p>',
            h2('Busiest cameras'),
            '<ol style="margin:0;padding-left:20px;color:' + INK2 + '">' + ''.join(
                f'<li style="margin:0 0 4px"><a href="{url(c["id"])}" style="color:{BLUE};text-decoration:none">{E(c["loc"])}</a>'
                f' · {KINDS[c["t"]]} · {c["m"][-1]:,} tickets</li>' for c in top) + '</ol>',
        ]
        if news[w]: body += [h2('What changed'), li([E(x) for x in news[w]])]
        if heads: body += [h2('Heads-up'), f'<p style="margin:0 0 4px;color:{INK2}">In their warning period, so tickets start soon:</p>',
                           li([f'<a href="{url(c["id"])}" style="color:{BLUE};text-decoration:none">{E(c["loc"])}</a> ({KINDS[c["t"]]})' for c in heads])]
        body.append(f'<p style="margin:22px 0 0;color:{INK2}"><b style="color:{INK}">Citywide:</b> {city:,} tickets and {usd(city_usd)} in fines, {change(city, city_b, before)}.</p>')
        if thanks: body += [h2('Fixed thanks to readers'), li([E(x) for x in thanks])]
        body += [
            f'<p style="margin:22px 0 0;color:{INK2}">Spot a camera we\'re missing, or one in the wrong place? Just reply to this email. I read every note, and fixes get credited here.</p>',
            f'<div style="margin:22px 0 0;padding:14px 16px 10px;border:1px solid {HAIR};border-left:3px solid {RED};border-radius:6px">'
            f'<p style="margin:0 0 10px;color:{INK}">This map is free and has no ads. If it saved you a ticket, please consider buying me a coffee ☕ '
            f'to keep it free and accessible to everyone.</p>{pills}'
            + (f'<p style="margin:4px 0 4px;font-size:13px;color:{INK2}">Or <a href="{E(monthly)}" style="color:{RED}">chip in {E(site.get("supporter_label", "monthly"))}</a> to keep these emails coming. Cancel anytime.</p>' if monthly else '')
            + (f'<p style="margin:6px 0 4px;font-size:13px;color:{INK2}">Kept going by {E(", ".join(backers))}. Thank you!</p>' if backers else '')
            + '</div>',
            f'<p style="margin:22px 0 0;color:{INK}">Drive safe,<br>DC Traffic Cameras Map Team<br><a href="{site_url}" style="color:{BLUE}">{site_url.split("//")[1].rstrip("/")}</a></p>',
        ]
        fine = (f'Last data: {last}. DDOT publishes each month\'s ticket counts around the 10th of the next month. Dollar figures use '
                f'the lowest fine for each camera type. You get this email because you signed up for Ward {w} on the map; to switch wards, '
                f'sign up again with the new one. <a href="{{{{UNSUB}}}}" style="color:{MUTED}">Unsubscribe</a>.'
                + (f' Monthly supporters can <a href="{E(manage)}" style="color:{MUTED}">cancel anytime here</a>.' if manage else ''))
        html = (f'<div style="background:#f3f4f5;padding:22px 10px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid {HAIR};'
                f'border-radius:8px;padding:24px 22px;font:400 15px/1.5 {SANS};color:{INK}">' + '\n'.join(body) + '</div>'
                f'<p style="max-width:560px;margin:14px auto 0;font:400 11.5px/1.5 {SANS};color:{MUTED}">{fine}</p></div>')
        txt = ['{{INTRO}}', f'LAST MONTH IN WARD {w}', '', f'{n:,} tickets · {usd(money)} in fines', f'{cap(change(n, nb, before))}. {rank_txt}',
               '', 'Busiest cameras:'] + [f'{i + 1}. {c["loc"]} · {KINDS[c["t"]]} · {c["m"][-1]:,} tickets  {url(c["id"])}' for i, c in enumerate(top)]
        if news[w]: txt += ['', 'What changed:'] + [f'- {x}' for x in news[w]]
        if heads: txt += ['', 'Heads-up, in their warning period so tickets start soon:'] + [f'- {c["loc"]} ({KINDS[c["t"]]})' for c in heads]
        txt += ['', f'Citywide: {city:,} tickets and {usd(city_usd)} in fines, {change(city, city_b, before)}.']
        if thanks: txt += ['', 'Fixed thanks to readers:'] + [f'- {x}' for x in thanks]
        txt += ['', "Spot a camera we're missing, or one in the wrong place? Just reply to this email. I read every note, and fixes get credited here.",
                '', 'This map is free and has no ads. If it saved you a ticket, please consider buying me a coffee ☕ to keep it free and accessible to everyone:']
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
