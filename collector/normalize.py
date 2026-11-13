"""No estimates: absent factual fields stay null/unknown. Classifications are labeled."""
import hashlib
import html
import re
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(text)).lower()
                   if not unicodedata.combining(c))


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag in ('p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'div'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'li', 'h1', 'h2', 'h3', 'h4', 'div'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value):
    parser = Text()
    parser.feed(html.unescape(str(value or '')))
    return '\n'.join(re.sub(r'\s+', ' ', line).strip()
                     for line in ''.join(parser.parts).splitlines() if line.strip())


def iso(value):
    if not value or not isinstance(value, str):
        return None
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return date.replace(tzinfo=date.tzinfo or timezone.utc).isoformat()
    except ValueError:
        return None


def canonical_url(value):
    parts = urlsplit(value)
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
        raise ValueError('Official HTTPS job URL required')
    # Preserve semantic query parameters (e.g. gh_jid); remove only trackers.
    query = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
                   if not k.lower().startswith('utm_') and k.lower() not in
                   ('gh_src', 'lever-source', 'lever-origin', 'source'))
    host = parts.netloc.lower()
    if host == 'boards.greenhouse.io':
        host = 'job-boards.greenhouse.io'
    return urlunsplit(('https', host, parts.path.rstrip('/'), urlencode(query), ''))


def canonical_key(url):
    return hashlib.sha256(canonical_url(url).encode()).hexdigest()


AREAS = [
    ('Localização', r'localization|localisation|tradut|traducao|linguist'),
    ('Narrativa', r'narrative|writer|roteir|narrativa'),
    ('Level Design', r'level design|world design'),
    ('Game Design', r'game design|design de jogos|systems design|combat design'),
    ('VFX', r'\bvfx\b|visual effects|efeitos visuais'),
    ('Animação', r'animat|animacao|animador|rigging'),
    ('Modelagem', r'modeler|modeller|modelagem|sculpt'),
    ('QA', r'\bqa\b|quality assurance|game test|tester|analista de testes'),
    ('Produção', r'producer|production|producao|produtor|project manager'),
    ('Comunidade', r'community|comunidade|player support|suporte'),
    ('Marketing', r'marketing|social media|creative strategy|user acquisition'),
    ('Áudio', r'audio|sound|som\b'),
    ('Arte', r'artist|arte\b|artista|illustrat|ui design|visual design'),
    ('Programação', r'engineer|programmer|developer|programa|desenvolv'),
]


def classify(title, department=''):
    for text in (fold(title), fold(department)):
        for area, pattern in AREAS:
            if re.search(pattern, text):
                return area
    return 'Outras'


def seniority(title):
    text = fold(title)
    for label, pattern in [
        ('Lead', r'\blead\b|principal|director|head of|diretor'),
        ('Sênior', r'senior|\bsr\b'), ('Estágio', r'\bintern\b|internship|estag'),
        ('Trainee', r'trainee|apprentice'), ('Júnior', r'junior|\bjr\b|entry.level|assistant|assistente'),
        ('Pleno', r'\bmid\b|mid.level|pleno')]:
        if re.search(pattern, text):
            return label
    return 'Não informado'


def geography(location, workplace, description):
    loc = fold(location)
    work = fold(workplace)
    mode = 'Não informado'
    if work == 'remote' or re.search(r'remot[eo]|\bremote\b', loc):
        mode = 'Remoto'
    if work == 'hybrid' or 'hybrid' in loc or 'hibrid' in loc:
        mode = 'Híbrido'
    if work in ('on-site', 'onsite') or re.search(r'presencial|in.office|on.site', loc):
        mode = 'Presencial'
    brazil = bool(re.search(r'\bbrazil\b|\bbrasil\b|sao paulo|belo horizonte|porto alegre|florianopolis|curitiba|rio de janeiro', loc))
    country = 'Brasil' if brazil else next((name for name, pattern in [
        ('Estados Unidos', r'united states|\busa\b|\bu\.s\.\b'), ('Canadá', r'canada'),
        ('Reino Unido', r'united kingdom|\buk\b'), ('Alemanha', r'germany'),
        ('Portugal', r'portugal'), ('Polônia', r'poland'), ('França', r'france'),
        ('Espanha', r'spain'), ('Argentina', r'argentina')]
        if re.search(pattern, loc)), None)
    eligibility, evidence = 'A confirmar', None
    # Location is an offered work location, never the company's boilerplate footprint.
    restriction = bool(re.search(r'(must|only).{0,35}(reside|based|resident).{0,35}(united states|usa|united kingdom|canada|europe)', fold(description)))
    if restriction:
        eligibility, evidence = 'Não', 'Restrição explícita de residência no anúncio; confira a descrição.'
    elif brazil:
        eligibility, evidence = 'Sim', f'Local de trabalho anunciado: {location}'
    elif mode == 'Remoto' and re.search(r'worldwide|anywhere in the world|global remote|remote.global|mundo todo', loc):
        eligibility, evidence = 'Sim', f'Abrangência mundial explícita na localização: {location}'
    priority = 6
    if mode == 'Remoto' and eligibility == 'Sim':
        priority = 2 if brazil else 1
    elif brazil and 'belo horizonte' in loc and mode in ('Presencial', 'Híbrido'):
        priority = 3
    elif brazil:
        priority = 4
    elif re.search(r'(visa sponsorship|relocation assistance|international applicants).{0,40}(available|provided|welcome|support)|we (offer|provide).{0,30}(visa sponsorship|relocation)', fold(description)):
        priority = 5
    city = next((name for name in ['Belo Horizonte', 'São Paulo', 'Porto Alegre', 'Rio de Janeiro', 'Curitiba', 'Florianópolis']
                 if fold(name) in loc), None)
    return dict(mode=mode, country=country, city=city, eligibility=eligibility,
                eligibility_evidence=evidence, priority=priority)


def sections(raw):
    """Extract only explicitly titled requirement/preference sections."""
    required, optional = [], []
    current = None
    for line in plain(raw).splitlines():
        heading = fold(line).strip(' :')
        if len(heading) < 100 and re.search(r'^(requirements|qualifications|what (we.re looking for|you bring|you.ll need|you will need)|requisitos|minimum qualifications|required skills)', heading):
            current = required
        elif len(heading) < 100 and re.search(r'^(nice to have|bonus|preferred|diferenciais|desejavel)', heading):
            current = optional
        elif len(heading) < 80 and re.search(r'^(benefits|about |responsibilities|what we offer|beneficios|responsabilidades)', heading):
            current = None
        elif current is not None:
            current.append(line)
    return '\n'.join(required) or None, '\n'.join(optional) or None


def normalize(raw, source):
    kind, board = source['type'], source['board']
    if not isinstance(raw, dict) or not raw.get('id'):
        raise ValueError('Missing source id')
    # ATS title fields are text, not HTML descriptions. Parsing them as markup
    # erases literal angle brackets (and can erase the entire supplied title).
    title_field = 'title' if kind == 'greenhouse' else 'text'
    raw_title = raw.get(title_field)
    if not isinstance(raw_title, str):
        raise ValueError(f'Invalid title: {title_field} must be a string')
    title = re.sub(r'\s+', ' ', html.unescape(raw_title)).strip()
    if not title or len(title) > 500:
        raise ValueError(f'Invalid title: {title_field} has {len(title)} characters after whitespace normalization')
    if kind == 'greenhouse':
        url = raw.get('absolute_url', '')
        location = (raw.get('location') or {}).get('name') or ''
        body = raw.get('content') or ''
        department = ' '.join(x['name'] for x in raw.get('departments', []) if x.get('name'))
        workplace, contract = '', 'Não informado'
        # updated_at is NOT a publication date.
        published = raw.get('first_published_at')
    elif kind == 'lever':
        url = raw.get('hostedUrl', '')
        cats = raw.get('categories') or {}
        location = cats.get('location') or ''
        department = cats.get('team') or cats.get('department') or ''
        body = raw.get('description') or raw.get('descriptionPlain') or ''
        body += ''.join(f'<h3>{html.escape(x.get("text", ""))}</h3>{x.get("content", "")}' for x in raw.get('lists', []))
        body += raw.get('additional') or ''
        workplace = raw.get('workplaceType') or ''
        contract = {'full-time':'Integral','full time':'Integral','part-time':'Meio período','part time':'Meio período',
                    'contract':'Temporário','temporary/contract':'Temporário','freelance':'Freelance'}.get(fold(cats.get('commitment', '')), 'Não informado')
        published = raw.get('publishedAt')  # createdAt is not guaranteed to be publication.
    else:
        raise ValueError('Unsupported ATS')
    url = canonical_url(url)
    description = plain(body)
    requirements, differentials = sections(body)
    job = dict(title=title, company=source['company'], source=kind, source_board=board,
               external_id=str(raw['id']), url=url, canonical_key=canonical_key(url),
               description=description or None, requirements=requirements, differentials=differentials,
               location=location or None, area=classify(title, department), level=seniority(title),
               contract=contract, posted_at=iso(published), deadline_at=iso(raw.get('validThrough')),
               salary_min=None, salary_max=None, salary_text=None, currency=None, salary_period=None,
               hours_per_day=None, weekly_hours=None, languages=[], language='Não informado')
    job.update(geography(location, workplace, description))
    # Structured published pay only; no inferred amounts or working hours.
    pay = raw.get('salaryRange') or {}
    if isinstance(pay, dict) and pay.get('currency'):
        for side in ('min', 'max'):
            value = pay.get(side)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0:
                job[f'salary_{side}'] = value
        job.update(currency=pay['currency'], salary_period=pay.get('interval'))
    if job['salary_min'] is not None and job['salary_max'] is not None and job['salary_min'] > job['salary_max']:
        raise ValueError('Invalid salary range')
    for language, pattern in [('Inglês', r'(english|ingles).{0,30}(required|fluent|proficien|obrigatorio)|fluent.{0,15}english'),
                              ('Português', r'(portuguese|portugues).{0,30}(required|fluent|nativ|obrigatorio)')]:
        if re.search(pattern, fold(requirements or description)):
            job['languages'].append(language)
    job['language'] = ', '.join(job['languages']) or 'Não informado'
    return job
