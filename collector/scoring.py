"""Documented, advisory profile fumec-v1; no automatic exclusions."""
import re
from .normalize import fold

PROFILE = {'Blueprints': r'blueprints?', 'Godot': r'godot', 'Roblox Studio': r'roblox',
           'Lógica/programação': r'programming|programacao|scripting|logic',
           'Prototipação': r'prototyp|prototip', 'Game design acadêmico': r'game design|design de jogos'}
GAPS = {'C++ profissional': r'c\+\+', 'Unity/C#': r'unity|c#', 'Maya': r'\bmaya\b',
        'Houdini': r'houdini', 'Portfólio especializado': r'portfolio',
        'Experiência profissional': r'\d+\+? years|\d+ anos', 'Inglês a confirmar': r'english|ingles'}


def assess(job):
    text = fold(job.get('requirements') or job.get('description') or '')
    level = job.get('level', 'Não informado')
    matches = [name for name, pattern in PROFILE.items() if re.search(pattern, text)]
    gaps = [name for name, pattern in GAPS.items() if re.search(pattern, text)]
    if len(text) < 100 or (level == 'Não informado' and not matches):
        return dict(score=None, score_reason='Compatibilidade não avaliada: faltam requisitos ou sinais suficientes de nível/competências.',
                    score_breakdown={}, gaps=gaps, scoring_version='fumec-v1')
    parts = {
        'seniority': {'Estágio':25, 'Trainee':25, 'Júnior':22, 'Pleno':12, 'Sênior':5, 'Lead':2}.get(level, 12),
        'skills': min(30, 10 + len(matches) * 5),
        'geography': {1:25, 2:25, 3:22, 4:17, 5:12, 6:8}.get(job.get('priority', 6), 8),
        'learning': 20 if level in ('Estágio','Trainee','Júnior') else 10,
    }
    if job.get('eligibility') == 'Não':
        parts['geography'] = 0
    reason = (f"Senioridade {parts['seniority']}/25; competências {parts['skills']}/30; "
              f"localização/elegibilidade {parts['geography']}/25; aprendizado {parts['learning']}/20. "
              f"Indícios alinhados: {', '.join(matches) or 'nenhum explícito; interesse em transição'}. "
              'Perfil acadêmico FUMEC; não presume experiência profissional ou fluência. '
              'Classificação heurística; confirme requisitos e elegibilidade no anúncio.')
    return dict(score=sum(parts.values()), score_reason=reason, score_breakdown=parts,
                gaps=gaps, scoring_version='fumec-v1')
