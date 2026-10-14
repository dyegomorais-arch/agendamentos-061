import { auth, signInWithEmailAndPassword, signOut } from './firebase.js';

// A tela de login sempre pede e-mail e senha: qualquer sessão que ainda exista é encerrada aqui.
const sessaoEncerrada = signOut(auth).catch(() => {});

const erros = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/user-disabled': 'Este usuário está desativado.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/network-request-failed': 'Sem conexão. Verifique sua internet.'
};

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const u = document.getElementById('user').value.trim();
  const p = document.getElementById('pass').value;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await sessaoEncerrada;
    await signInWithEmailAndPassword(auth, u, p);
    location.href = 'agenda.html';
  } catch (err) {
    console.error(err);
    document.getElementById('err').textContent = erros[err.code] || 'Não foi possível entrar. Tente novamente.';
    const c = document.getElementById('loginForm');
    c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
    btn.disabled = false;
  }
});
