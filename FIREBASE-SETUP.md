# OS 061 - projeto Firebase próprio (agenda-061)

Já feito no console: projeto, Authentication (e-mail/senha), Firestore e regras (firestore.rules).

Publicar o site (dentro da pasta da OS 061, no terminal):
1. `npm i -g firebase-tools`
2. `firebase login`
3. `firebase deploy --only hosting`   (o .firebaserc já aponta para agenda-061)
4. Endereço: https://agenda-061.web.app
5. Authentication > Configurações > Domínios autorizados: confira que `agenda-061.web.app` está na lista.

Teste local antes: `npx serve .` (ES modules não funcionam abrindo o arquivo direto).
