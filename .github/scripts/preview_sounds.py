"""يجمع أصواتاً بديلة لصفحة تجربة الأصوات (public/sounds/preview.html) — لا يغيّر أصوات اللعبة.

المصادر:
  • Mixkit (رخصة Mixkit المجانية): لا نعيد رفع ملفاتها، الصفحة تشغّلها من موقعهم مباشرة
  • OpenGameArt (CC0) و Kenney (CC0): تُنزَّل وتُحوَّل إلى mp3 في public/sounds/preview/
والناتج catalog.json: لكل صوت فئته واسمه ورابطه ومصدره ورخصته.
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
import zipfile

OUT = 'public/sounds/preview'
TMP = '/tmp/preview-src'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; majlisk-sound-preview)'}
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
catalog = []


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def to_mp3(src, name, seconds=4):
    dst = f'{OUT}/{name}.mp3'
    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', src, '-t', str(seconds),
                    '-ac', '1', '-ar', '44100', '-b:a', '64k', dst], check=True)
    return f'preview/{name}.mp3'


def add(cat, title, src, source, license_):
    catalog.append({'cat': cat, 'title': title, 'src': src, 'source': source, 'license': license_})


# ───── Mixkit: نقرأ صفحة كل فئة ونأخذ روابط المعاينة وعناوينها ─────
MIXKIT = {
    'turn': ['notification', 'bell', 'alert'],
    'cards': ['casino', 'cards'],
    'bid': ['coin', 'money', 'chips'],
    'win': ['win', 'success', 'game-show', 'jackpot'],
    'lose': ['lose', 'fail', 'game-over'],
}
seen = set()
for cat, slugs in MIXKIT.items():
    for slug in slugs:
        url = f'https://mixkit.co/free-sound-effects/{slug}/'
        try:
            page = get(url).decode('utf-8', 'replace')
        except Exception as e:  # فئة غير موجودة
            print('mixkit skip', slug, e)
            continue
        # كل بطاقة صوت: عنوانها ثم رابط معاينتها
        cards = re.split(r'(?=<div[^>]+class="[^"]*item-grid__item)', page)
        n = 0
        for c in cards:
            m = re.search(r'https://assets\.mixkit\.co/active_storage/sfx/(\d+)/\1-preview\.mp3', c)
            t = re.search(r'item-grid-card__title[^>]*>\s*([^<]+?)\s*<', c)
            if not m or m.group(0) in seen:
                continue
            seen.add(m.group(0))
            add(cat, html.unescape(t.group(1)) if t else f'Mixkit {m.group(1)}', m.group(0), 'Mixkit', 'Mixkit License')
            n += 1
            if n >= 14:
                break
        print('mixkit', slug, n)
        if n == 0:
            print(page[:1500])

# ───── OpenGameArt (CC0): نزّل ملفات الصفحة الصوتية ─────
OGA = {
    'card-game-sounds': 'cards',      # HaelDB — أصوات لعبة ورق كاملة، منها تمرير الدور
    'victory': 'win',                 # celestialghost8
    'win-jingle': 'win',              # Fupi — عدة آلات
    'win-fanfare': 'win',             # gchoc
    'fanfares': 'win',                # Spring Spring (CC-BY: يتطلب ذكر صاحبه)
}
for slug, cat in OGA.items():
    try:
        page = get(f'https://opengameart.org/content/{slug}').decode('utf-8', 'replace')
    except Exception as e:
        print('oga skip', slug, e)
        continue
    lic = 'CC0' if 'cc0' in page.lower() else 'CC-BY'
    links = sorted(set(re.findall(r'https://opengameart\.org/sites/default/files/[^"\'<>\s]+\.(?:zip|ogg|wav|mp3)', page)))
    print('oga', slug, lic, links)
    files = []
    for link in links:
        local = f'{TMP}/{slug}-{os.path.basename(link)}'
        try:
            open(local, 'wb').write(get(link))
        except Exception as e:
            print('oga download fail', link, e)
            continue
        if local.endswith('.zip'):
            d = local[:-4]
            zipfile.ZipFile(local).extractall(d)
            for root, _, names in os.walk(d):
                files += [os.path.join(root, x) for x in names if x.lower().endswith(('.ogg', '.wav', '.mp3'))]
        else:
            files.append(local)
    for i, f in enumerate(sorted(files)[:30]):
        base = os.path.splitext(os.path.basename(f))[0]
        name = re.sub(r'[^A-Za-z0-9_-]+', '-', f'oga-{slug}-{base}')[:80]
        title = base.replace('_', ' ').replace('-', ' ')
        c = cat
        if slug == 'card-game-sounds' and re.search(r'notif|pass', base, re.I):
            c = 'turn'
        if slug == 'fanfares' and re.search(r'lose', base, re.I):
            c = 'lose'
        try:
            add(c, title, to_mp3(f, name), 'OpenGameArt', lic)
        except subprocess.CalledProcessError:
            print('convert fail', f)

# ───── Kenney (CC0): حزم إضافية ─────
KENNEY = {
    'interface-sounds': [('turn', r'(glass|confirmation|bong|pluck|maximize)_0')],
    'rpg-audio': [('bid', r'(handleCoins|metalClick|bookPlace|clothBelt)'), ('cards', r'bookFlip')],
    'digital-audio': [('win', r'(powerUp|phaserUp|threeTone)'), ('lose', r'(lowDown|phaserDown|pepSound)')],
    'casino-audio': [('bid', r'(chips-stack|chip-lay|chips-collide)'), ('cards', r'(card-slide|card-fan|cards-pack)')],
    'music-jingles': [('win', r'jingles_(STEEL|PIZZI|NES)'), ('lose', r'jingles_SAX')],
}
for pack, rules in KENNEY.items():
    try:
        page = get(f'https://kenney.nl/assets/{pack}').decode('utf-8', 'replace')
        z = re.search(rf'https://kenney\.nl/media/pages/assets/{pack}/[^"]+\.zip', page).group(0)
        local = f'{TMP}/{pack}.zip'
        open(local, 'wb').write(get(z))
        zipfile.ZipFile(local).extractall(f'{TMP}/{pack}')
    except Exception as e:
        print('kenney skip', pack, e)
        continue
    oggs = []
    for root, _, names in os.walk(f'{TMP}/{pack}'):
        oggs += [os.path.join(root, x) for x in names if x.lower().endswith('.ogg')]
    for cat, pattern in rules:
        picked = sorted(f for f in oggs if re.search(pattern, os.path.basename(f), re.I))[:16]
        for f in picked:
            base = os.path.splitext(os.path.basename(f))[0]
            add(cat, base, to_mp3(f, f'kenney-{pack}-{base}'), 'Kenney', 'CC0')

json.dump(catalog, open(f'{OUT}/catalog.json', 'w'), ensure_ascii=False, indent=1)
print('total', len(catalog), {c: sum(1 for x in catalog if x['cat'] == c) for c in MIXKIT})
