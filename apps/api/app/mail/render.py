"""The account e-mails, in pt-BR, each as HTML (templates/, based on docs/design/emails) and plain
text. Templates use {{name}} (escaped), {{{name}}} (already-built HTML) and {{#name}}...{{/name}}
(only when name is set). Images are PNGs served by the API (Gmail doesn't show SVG)."""

import html
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from app import releases
from app.config import get_settings
from app.mail.providers import Email

TEMPLATES = Path(__file__).parent / "templates"

_SECTION = re.compile(r"\{\{#(\w+)\}\}(.*?)\{\{/\1\}\}", re.S)
_RAW = re.compile(r"\{\{\{(\w+)\}\}\}")
_ESCAPED = re.compile(r"\{\{(\w+)\}\}")


@cache
def _template(name: str) -> str:
    return (TEMPLATES / f"{name}.html").read_text(encoding="utf-8")


def fill(template: str, values: dict[str, Any]) -> str:
    template = _SECTION.sub(lambda m: m.group(2) if values.get(m.group(1)) else "", template)
    template = _RAW.sub(lambda m: str(values.get(m.group(1), "")), template)
    return _ESCAPED.sub(lambda m: html.escape(str(values.get(m.group(1), ""))), template)


def mask(address: str) -> str:
    """ed***@gmail.com: enough to recognize it, not to read it off a log or a notice."""
    local, _, domain = address.partition("@")
    return f"{local[:2]}***@{domain}" if domain else "***"


@dataclass(frozen=True)
class _Code:
    subject: str
    preheader: str
    eyebrow: str
    title: str
    intro: str
    warning: str
    reason: str


CODES = {
    "code_verify": _Code(
        subject="Seu código do Aureum: {codigo}",
        preheader="Seu código do Aureum: vale por 15 minutos.",
        eyebrow="CONFIRMAÇÃO DE E-MAIL",
        title="Seu código de confirmação",
        intro="Digite este código no Aureum para confirmar seu e-mail, {nome}.",
        warning="Não foi você que criou essa conta? Pode ignorar este e-mail, nada acontece sem o código.",
        reason="Você recebeu este e-mail porque criou uma conta no Aureum com",
    ),
    "code_reset": _Code(
        subject="Código para trocar sua senha: {codigo}",
        preheader="Seu código para criar uma senha nova: vale por 15 minutos.",
        eyebrow="ESQUECI A SENHA",
        title="Seu código para trocar a senha",
        intro="Digite este código no Aureum para criar uma senha nova, {nome}. Ao trocar, as outras sessões abertas da sua conta são encerradas.",
        warning="Não foi você que pediu? Pode ignorar este e-mail: sua senha continua a mesma.",
        reason="Você recebeu este e-mail porque alguém pediu pra trocar a senha da conta do Aureum ligada a",
    ),
    "code_change_email": _Code(
        subject="Confirme seu novo e-mail: {codigo}",
        preheader="Confirme o novo e-mail da sua conta: o código vale por 15 minutos.",
        eyebrow="TROCA DE E-MAIL",
        title="Confirme seu novo e-mail",
        intro="Digite este código no Aureum para usar este endereço na sua conta, {nome}.",
        warning="Não foi você que pediu? Pode ignorar este e-mail, nada muda sem o código.",
        reason="Você recebeu este e-mail porque alguém quer usar no Aureum o endereço",
    ),
}


def _code(template: str, p: dict[str, Any]) -> tuple[dict[str, Any], str]:
    c = CODES[template]
    values = {
        "subject": c.subject.format(**p), "preheader": c.preheader, "eyebrow": c.eyebrow, "title": c.title,
        "intro": c.intro.format(**p), "warning": c.warning, "reason": c.reason, "codigo": p["codigo"],
    }
    values["body"] = fill(_template("code"), values)
    text = (
        f"{c.title}\n\n{values['intro']}\n\n    {p['codigo']}\n\nVale por 15 minutos.\n\n"
        f"{c.warning} Não passe esse código pra ninguém: o Aureum nunca vai pedir ele pra você."
    )
    return values, text


def _step(number: int, title: str, html_text: str) -> str:
    return (
        '<tr><td width="40" valign="top" style="padding:0 0 18px"><div style="width:28px;height:28px;line-height:28px;'
        "border-radius:14px;background:#2A1F08;border:1px solid #5A4413;text-align:center;font-family:Sora,'Segoe UI',"
        f"Arial,sans-serif;font-size:13px;font-weight:700;color:#E8B531\">{number}</div></td>"
        "<td valign=\"top\" style=\"padding:3px 0 18px;font-family:Figtree,'Segoe UI',Arial,sans-serif;font-size:15px;"
        f'line-height:1.5;color:#D9D2C3"><b style="color:#F4EFE4;font-weight:700">{html.escape(title)}</b> {html_text}</td></tr>'
    )


async def _welcome(p: dict[str, Any]) -> tuple[dict[str, Any], str]:
    steps: list[tuple[str, str, str]] = []  # title, html, text
    if p.get("servidor"):
        text = "É onde a gente conversa sobre o app, testa as calls e conta as novidades primeiro."
        steps.append(("Você já está no servidor do beta.", html.escape(text), text))
    if p.get("convites"):
        n = int(p["convites"])
        steps.append((
            "Chame seus amigos.",
            "O beta é fechado, então só entra quem recebe convite. Você tem "
            f"<b style='color:#E8B531'>{n} convites</b> em Configurações › Convites.",
            f"O beta é fechado, então só entra quem recebe convite. Você tem {n} convites em Configurações › Convites.",
        ))
    steps.append((
        "Achou algo estranho? Reporte.",
        "O botão de bug fica nas configurações. Bug resolvido vira a insígnia "
        "<span style='color:#C9D1DA;font-weight:700'>Caçador de bugs</span>.",
        "O botão de bug fica nas configurações. Bug resolvido vira a insígnia Caçador de bugs.",
    ))
    download = (await releases.latest()).url
    values = {
        "subject": f"Boas-vindas ao Aureum! Sua insígnia Pioneiro nº {p['numero']}" if p.get("numero") else "Boas-vindas ao Aureum!",
        "preheader": "Sua conta está pronta, e você ganhou a insígnia Pioneiro." if p.get("numero") else "Sua conta está pronta.",
        "eyebrow": "BOAS-VINDAS",
        "title": f"Que bom ter você aqui, {p['nome']}.",
        "intro": "Sua conta no Aureum está pronta. Você chegou no começo de tudo: o app ainda está em beta, e cada "
        "conversa, cada call e cada bug que você encontrar ajuda a decidir o que ele vai ser.",
        "reason": "Você recebeu este e-mail porque criou uma conta no Aureum com",
        "numero": p.get("numero"),
        "steps": "".join(_step(i, title, body) for i, (title, body, _) in enumerate(steps, 1)),
        "app_url": download,
        "badge_url": f"{get_settings().public_url}/static/email/pioneiro.png",
    }
    values["body"] = fill(_template("welcome"), values)
    lines = [values["title"], "", values["intro"], ""]
    if p.get("numero"):
        lines += [f"Insígnia mítica: Pioneiro nº {p['numero']}. Ela já está no seu perfil e fica lá pra sempre.", ""]
    lines += ["Pra começar:"] + [f"{i}. {title} {text}" for i, (title, _, text) in enumerate(steps, 1)]
    lines += ["", f"Baixar o Aureum (Windows): {download}", "", "Qualquer coisa, é só responder este e-mail. Quem lê é gente.", "— Eduardo, do Aureum"]
    return values, "\n".join(lines)


HELP = "Use “Esqueci minha senha” na tela de entrada do Aureum pra recuperar sua conta, ou responda este e-mail que a gente ajuda."


def _notice(template: str, p: dict[str, Any]) -> tuple[dict[str, Any], str]:
    when = p["quando"]  # formatted by whoever queues it, in Brasília time
    if template == "notice_password":
        title, details = "Sua senha foi trocada", f"A senha da sua conta <b style='color:#F4EFE4'>@{html.escape(p['username'])}</b> foi trocada em {html.escape(when)}. As outras sessões foram encerradas."
        plain = f"A senha da sua conta @{p['username']} foi trocada em {when}. As outras sessões foram encerradas."
    else:
        title = "O e-mail da sua conta foi trocado"
        details = (
            f"A conta <b style='color:#F4EFE4'>@{html.escape(p['username'])}</b> agora usa o e-mail "
            f"<b style='color:#F4EFE4'>{html.escape(p['novo'])}</b>. A troca foi feita em {html.escape(when)}, e este endereço não recebe mais os e-mails dela."
        )
        plain = f"A conta @{p['username']} agora usa o e-mail {p['novo']}. A troca foi feita em {when}, e este endereço não recebe mais os e-mails dela."
    values = {
        "subject": title, "preheader": plain, "eyebrow": "AVISO DE SEGURANÇA", "title": title,
        "intro": f"Oi, {p['nome']}. Estamos avisando porque foi uma mudança importante na sua conta.",
        "reason": "Você recebeu este e-mail porque este é o endereço da sua conta no Aureum:"
        if template == "notice_password" else "Você recebeu este e-mail porque este era o endereço da sua conta no Aureum:",
        "details": details, "help": HELP,
    }
    values["body"] = fill(_template("notice"), values)
    return values, f"{title}\n\n{values['intro']}\n\n{plain}\n\nFoi você? Então está tudo certo.\nNão foi? {HELP}"


NAMES = (*CODES, "welcome", "notice_password", "notice_email")


async def render(template: str, to: str, params: dict[str, Any]) -> Email:
    if template in CODES:
        values, text = _code(template, params)
    elif template == "welcome":
        values, text = await _welcome(params)
    elif template in ("notice_password", "notice_email"):
        values, text = _notice(template, params)
    else:
        raise KeyError(template)
    base = get_settings().public_url
    values |= {"email": to, "logo_url": f"{base}/static/email/logo.png"}
    page = fill(_template("layout"), values)
    footer = f"\n\n--\n{values['reason']} {to}.\nAureum · feito por gente, pra gente conversar.\n"
    return Email(to=to, subject=values["subject"], html=page, text=text + footer)
