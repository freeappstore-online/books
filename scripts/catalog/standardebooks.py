"""Read complete Standard Ebooks source XHTML in its EPUB spine order.

The Git commit and archive SHA-256 are pinned. No archive member is extracted to disk.
Only bodymatter enters the reader; publisher pages and chapter headings stay out of narration.
"""
import io, os, re, tarfile, urllib.request
import xml.etree.ElementTree as ET

X = '{http://www.w3.org/1999/xhtml}'
O = '{http://www.idpf.org/2007/opf}'
EPUB_TYPE = '{http://www.idpf.org/2007/ops}type'


def archive(cache: str, src: dict, lock, user_agent: str) -> bytes:
    repo = src['standardebooks'].replace('/', '_')
    revision = src['revision']
    path = os.path.join(cache, f'standardebooks-{repo}-{revision}.tar.gz')
    if not os.path.exists(path):
        url = f'https://codeload.github.com/standardebooks/{repo}/tar.gz/{revision}'
        req = urllib.request.Request(url, headers={'User-Agent': user_agent})
        data = urllib.request.urlopen(req, timeout=120).read()
        with open(path, 'wb') as f:
            f.write(data)
    with open(path, 'rb') as f:
        data = f.read()
    lock.check(f'standardebooks:{repo}:{revision}', data)
    return data


def inline(element) -> str:
    """Keep inline punctuation and authorial line breaks, discarding XML indentation."""
    out = element.text or ''
    for child in element:
        tag = child.tag.removeprefix(X)
        if tag == 'br':
            out += '\u0000'
        elif tag == 'img':
            out += f"[{child.attrib.get('alt', 'Illustration')}]"
        else:
            out += inline(child)
        out += child.tail or ''
    return out


def clean(text: str) -> str:
    return '\n'.join(re.sub(r'\s+', ' ', line).strip() for line in text.split('\u0000')).strip()


def blocks(element) -> list[str]:
    out = []
    for child in element:
        tag = child.tag.removeprefix(X)
        if tag in {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup'}:
            continue
        if tag == 'p':
            if text := clean(inline(child)):
                out.append(text)
        elif tag in {'ol', 'ul'}:
            for i, item in enumerate(child.findall(f'{X}li'), int(child.get('start', '1'))):
                text = '\n\n'.join(blocks(item)) or clean(inline(item))
                out.append(f'{i}. {text}' if tag == 'ol' else f'• {text}')
        elif tag == 'hr':
            out.append('* * *')
        else:
            out.extend(blocks(child))
    return out


def chapters(data: bytes) -> list[dict]:
    """Every bodymatter chapter in the package spine, including one-line authorial chapters."""
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
        opfs = [name for name in package.getnames() if name.endswith('/src/epub/content.opf')]
        if len(opfs) != 1:
            raise ValueError('Standard Ebooks archive must contain one source content.opf')
        opf_path = opfs[0]
        root = ET.fromstring(package.extractfile(opf_path).read())
        manifest = {item.attrib['id']: item.attrib['href'] for item in root.findall(f'{O}manifest/{O}item')}
        out, part = [], ''
        for ref in root.findall(f'{O}spine/{O}itemref'):
            href = manifest[ref.attrib['idref']]
            doc = ET.fromstring(package.extractfile(opf_path.rsplit('/', 1)[0] + '/' + href).read())
            body = doc.find(f'{X}body')
            if body is None or 'bodymatter' not in body.get(EPUB_TYPE, '').split():
                continue
            title = clean(''.join(doc.find(f'{X}head/{X}title').itertext()))
            sections = list(body)
            if sections and 'part' in sections[0].get(EPUB_TYPE, '').split():
                if blocks(body):
                    raise ValueError(f'Part contains prose instead of a heading-only divider: {href}')
                part = title
                continue
            content = '\n\n'.join(blocks(body))
            if not content:
                raise ValueError(f'Empty bodymatter chapter: {href}')
            chapter_number = len(out) + 1
            label = f'{part}, Chapter {title}' if part else f'Chapter {chapter_number}: {title}'
            out.append({'title': label, 'content': content})
        return out
