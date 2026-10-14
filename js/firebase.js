// Inicialização única do Firebase (SDK modular via CDN). A versão fica só aqui.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { initializeAuth, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
// Login só vale para a aba/sessão atual: ao fechar o navegador (ou a aba), pede e-mail e senha de novo.
export const auth = initializeAuth(app, { persistence: browserSessionPersistence });
// Banco padrão do projeto agenda-061 (totalmente separado do projeto da OS 516).
export const db = getFirestore(app);

export { onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
export { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
