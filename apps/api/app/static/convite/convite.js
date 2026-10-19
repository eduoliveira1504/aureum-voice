// The invite page: sign up (step 1), type the e-mailed code (step 2), get the Pioneiro badge and
// the download (step 3). No web login: the tokens from sign-up live only in this page's memory
// (no localStorage/sessionStorage) and only confirm the e-mail. Reloading after sign-up means
// confirming in the app instead.
'use strict'

const $ = (id) => document.getElementById(id)

const MESSAGES = {
  'An invite code is required to sign up': 'Você precisa de um código de convite.',
  'Invalid invite code': 'Esse código de convite não existe. Confira o link.',
  'This invite was already used': 'Esse convite já foi usado.',
  'This invite has no spots left': 'As vagas desse convite acabaram.',
  'This invite has expired': 'Esse convite venceu.',
  'This username is reserved': 'Esse nome é reservado.',
  'This username is already taken': 'Esse @ já tem dono.',
  'This email is already taken': 'Já existe uma conta com esse e-mail.',
  'Username or email already taken': 'Esse @ ou e-mail já está em uso.',
  'Wrong code': 'Código errado. Confira o e-mail e tente de novo.',
  'This code has expired; ask for a new one': 'Esse código venceu. Peça um novo.',
  'Too many wrong tries; ask for a new code': 'Muitas tentativas erradas. Peça um código novo.',
  'Wait a moment before asking for another code': 'Espere um pouquinho antes de pedir outro código.',
  'This e-mail is already confirmed': 'Esse e-mail já foi confirmado.'
}
const CLOSED = {
  missing: 'Não achamos esse convite. Confira se o link veio inteiro.',
  used: 'Esse convite já foi usado por outra pessoa.',
  exhausted: 'As vagas desse convite de grupo acabaram.',
  expired: 'Esse convite venceu.'
}

const state = { tokens: null, email: '', username: '', resendAt: 0 }

function explain(status, detail) {
  if (status === 429) return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'
  if (typeof detail === 'string' && MESSAGES[detail]) return MESSAGES[detail]
  if (Array.isArray(detail)) {
    const field = detail[0]?.loc?.at(-1)
    if (field === 'username') return 'O @ precisa de 3 a 32 letras, números, _ ou ponto.'
    if (field === 'email') return 'Esse e-mail não parece certo.'
    if (field === 'password' || field === 'new_password') return 'A senha precisa de pelo menos 8 caracteres.'
  }
  if (status === 0) return 'Sem conexão. Confira a internet e tente de novo.'
  return 'Algo deu errado. Tente de novo em instantes.'
}

async function call(method, path, body, retried = false) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (state.tokens) headers.Authorization = `Bearer ${state.tokens.access_token}`
  let res
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    return { ok: false, status: 0, data: null }
  }
  // The access token lasts 15 minutes; refresh once with the one in memory.
  if (res.status === 401 && state.tokens && !retried) {
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: state.tokens.refresh_token })
    })
    if (refreshed.ok) {
      state.tokens = await refreshed.json()
      return call(method, path, body, true)
    }
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data, headers: res.headers }
}

function show(step) {
  for (const id of ['loading', 'closed', 'step-1', 'step-2', 'step-3']) $(id).hidden = id !== step
  const n = Number(step.split('-')[1] || 0)
  for (const dot of document.querySelectorAll('.dot')) {
    const d = Number(dot.dataset.step)
    dot.classList.toggle('current', d === n)
    dot.classList.toggle('done', d < n)
  }
  window.scrollTo(0, 0)
}

function setError(id, message) {
  $(id).textContent = message || ''
  $(id).hidden = !message
}

function busy(button, on, label) {
  button.disabled = on
  if (label) button.textContent = label
}

// --- Step 1 ------------------------------------------------------------------

function showInviter(invite) {
  const text = $('inviter-text')
  text.textContent = ''
  const avatar = $('inviter-avatar')
  if (invite.inviter) {
    const who = document.createElement('b')
    who.textContent = `@${invite.inviter.username}`
    text.append(who, ' te chamou pro beta fechado do Aureum.')
    if (invite.inviter.avatar_url) {
      const img = document.createElement('img')
      img.src = invite.inviter.avatar_url
      img.alt = ''
      avatar.replaceChildren(img)
    } else {
      avatar.textContent = (invite.inviter.display_name || invite.inviter.username).charAt(0).toUpperCase()
    }
  } else {
    avatar.replaceChildren(document.querySelector('.mark').cloneNode(true))
    text.append('Você recebeu um convite pro beta fechado do Aureum.')
  }
  if (invite.kind === 'group' && invite.remaining != null) {
    const spots = invite.remaining === 1 ? '1 vaga restante' : `${invite.remaining} vagas restantes`
    text.append(` Convite do grupo · ${spots}.`)
  }
}

let checkTimer = 0
let lastChecked = ''
async function checkUsername() {
  const status = $('username-status')
  const name = $('username').value.trim().replace(/^@/, '')
  status.className = 'status'
  status.textContent = ''
  if (!name) return
  if (!/^[A-Za-z0-9_.]{3,32}$/.test(name)) {
    status.classList.add('bad')
    status.textContent = name.length < 3 ? '' : 'inválido'
    return
  }
  lastChecked = name
  const res = await call('GET', `/auth/username-available?username=${encodeURIComponent(name)}`)
  if (lastChecked !== name || !res.ok) return
  if (res.data.available) {
    status.classList.add('ok')
    status.textContent = '✓ disponível'
  } else {
    status.classList.add('bad')
    status.textContent = { taken: 'já tem dono', reserved: 'reservado', invalid: 'inválido' }[res.data.reason] || 'indisponível'
  }
}

async function signUp(event) {
  event.preventDefault()
  setError('signup-error', '')
  const button = $('signup-submit')
  const body = {
    invite_code: $('code').value.trim(),
    username: $('username').value.trim().replace(/^@/, ''),
    email: $('email').value.trim(),
    password: $('password').value
  }
  if (body.password.length < 8) return setError('signup-error', 'A senha precisa de pelo menos 8 caracteres.')
  busy(button, true, 'Criando…')
  const res = await call('POST', '/auth/register', body)
  busy(button, false, 'Criar conta')
  if (!res.ok) return setError('signup-error', explain(res.status, res.data?.detail))
  state.tokens = res.data
  state.email = body.email.toLowerCase()
  state.username = body.username.toLowerCase()
  $('password').value = ''
  startStep2()
}

// --- Step 2 ------------------------------------------------------------------

function boxes() {
  return [...document.querySelectorAll('.box')]
}

function buildBoxes() {
  const group = $('boxes')
  for (let i = 0; i < 6; i++) {
    const box = document.createElement('input')
    box.className = 'box'
    box.inputMode = 'numeric'
    box.maxLength = 1
    box.autocomplete = i === 0 ? 'one-time-code' : 'off'
    box.setAttribute('aria-label', `Dígito ${i + 1}`)
    group.append(box)
  }
  group.addEventListener('input', (event) => {
    const box = event.target
    const all = boxes()
    const digits = box.value.replace(/\D/g, '')
    if (digits.length > 1) return fill(digits, all.indexOf(box)) // pasted or autofilled
    box.value = digits
    if (digits) all[all.indexOf(box) + 1]?.focus()
    if (code().length === 6) $('verify').requestSubmit()
  })
  group.addEventListener('keydown', (event) => {
    const all = boxes()
    const i = all.indexOf(event.target)
    if (event.key === 'Backspace' && !event.target.value && i > 0) all[i - 1].focus()
    if (event.key === 'ArrowLeft' && i > 0) all[i - 1].focus()
    if (event.key === 'ArrowRight' && i < 5) all[i + 1].focus()
  })
  group.addEventListener('paste', (event) => {
    const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '')
    if (!digits) return
    event.preventDefault()
    fill(digits, 0)
  })
}

function fill(digits, from) {
  const all = boxes()
  for (let i = from; i < 6 && i - from < digits.length; i++) all[i].value = digits[i - from]
  all[Math.min(from + digits.length, 5)].focus()
  if (code().length === 6) $('verify').requestSubmit()
}

function code() {
  return boxes().map((b) => b.value).join('')
}

let resendTimer = 0
function startCountdown(seconds) {
  state.resendAt = Date.now() + seconds * 1000
  clearInterval(resendTimer)
  const tick = () => {
    const left = Math.ceil((state.resendAt - Date.now()) / 1000)
    const button = $('resend')
    if (left <= 0) {
      clearInterval(resendTimer)
      button.disabled = false
      button.textContent = 'reenviar código'
    } else {
      button.disabled = true
      button.textContent = `reenviar em 0:${String(left).padStart(2, '0')}`
    }
  }
  tick()
  resendTimer = setInterval(tick, 1000)
}

function startStep2() {
  $('sent-to').textContent = state.email
  $('verify').hidden = false
  $('new-email').hidden = true
  for (const b of boxes()) b.value = ''
  setError('verify-error', '')
  show('step-2')
  startCountdown(60)
  boxes()[0].focus()
}

let verifying = false
async function verify(event) {
  event.preventDefault()
  if (verifying) return
  const value = code()
  if (value.length !== 6) return setError('verify-error', 'Digite os 6 números do código.')
  verifying = true
  busy($('verify-submit'), true, 'Confirmando…')
  const res = await call('POST', '/auth/verify-email', { code: value })
  verifying = false
  busy($('verify-submit'), false, 'Confirmar')
  if (!res.ok) {
    setError('verify-error', explain(res.status, res.data?.detail))
    for (const b of boxes()) b.value = ''
    boxes()[0].focus()
    return
  }
  showDone(res.data)
}

async function resend() {
  setError('verify-error', '')
  const res = await call('POST', '/auth/resend-code')
  if (res.ok) return startCountdown(60)
  const wait = Number(res.headers?.get('Retry-After'))
  if (res.status === 429 && wait > 0 && wait <= 60) return startCountdown(wait)
  setError('verify-error', explain(res.status, res.data?.detail))
}

async function changeEmail(event) {
  event.preventDefault()
  setError('new-email-error', '')
  const email = $('new-email-input').value.trim()
  const res = await call('PATCH', '/auth/pending-email', { email })
  if (!res.ok) return setError('new-email-error', explain(res.status, res.data?.detail))
  state.email = res.data.email
  startStep2()
}

// --- Step 3 ------------------------------------------------------------------

function isPhone() {
  return navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

async function showDone(result) {
  clearInterval(resendTimer)
  $('done-title').textContent = `Tudo pronto, @${result.user.username}.`
  if (result.pioneer_number != null) {
    $('pioneer-number').textContent = String(result.pioneer_number).padStart(2, '0')
    $('badge-card').hidden = false
  }
  $('mobile-note').hidden = !isPhone()
  show('step-3')
  // Nothing else needs the session: forget it.
  state.tokens = null

  const release = await call('GET', '/app/latest-release')
  const info = []
  if (release.ok) {
    $('download').href = release.data.url
    if (release.data.version) info.push(`Versão ${release.data.version}`)
    if (release.data.size_bytes) info.push(`${Math.round(release.data.size_bytes / 1e6)} MB`)
  }
  if (result.joined_official) info.push('você já está no servidor do beta')
  $('download-info').textContent = info.join(' · ')
}

// --- Start -------------------------------------------------------------------

async function start() {
  buildBoxes()
  $('signup').addEventListener('submit', signUp)
  $('verify').addEventListener('submit', verify)
  $('resend').addEventListener('click', resend)
  $('change-email').addEventListener('click', () => {
    $('verify').hidden = true
    $('new-email').hidden = false
    $('new-email-input').value = state.email
    $('new-email-input').focus()
  })
  $('cancel-email').addEventListener('click', () => {
    $('new-email').hidden = true
    $('verify').hidden = false
  })
  $('new-email').addEventListener('submit', changeEmail)
  $('reveal').addEventListener('click', () => {
    const input = $('password')
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    $('reveal').textContent = showing ? 'mostrar' : 'esconder'
  })
  $('username').addEventListener('input', () => {
    clearTimeout(checkTimer)
    checkTimer = setTimeout(checkUsername, 350)
  })

  const invite = document.body.dataset.code || ''
  $('code').value = invite
  const res = invite ? await call('GET', `/account-invites/${encodeURIComponent(invite)}`) : { ok: false, status: 404 }
  if (!res.ok && res.status !== 404) {
    // Couldn't check it (connection, too many tries): let them try; sign-up checks it anyway.
    $('inviter').hidden = true
    return show('step-1')
  }
  const reason = !res.ok ? 'missing' : res.data.status !== 'valid' ? res.data.status : null
  if (reason) {
    $('closed-reason').textContent = CLOSED[reason]
    return show('closed')
  }
  showInviter(res.data)
  show('step-1')
}

start()
