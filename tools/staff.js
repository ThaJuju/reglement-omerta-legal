#!/usr/bin/env node
/* Gestion des comptes staff — node tools/staff.js <commande> */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS = path.join(__dirname, '..', 'data', 'users.json');
const hashPwd = (pwd, salt) => crypto.scryptSync(pwd, salt, 64).toString('hex');
const load = () => { try { return JSON.parse(fs.readFileSync(USERS, 'utf8')); } catch { return []; } };
const save = u => {
  fs.mkdirSync(path.dirname(USERS), { recursive: true });
  fs.writeFileSync(USERS, JSON.stringify(u, null, 1), { mode: 0o600 });
};
const makeUser = (username, password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return { username, salt, hash: hashPwd(password, salt), createdAt: new Date().toISOString() };
};
const randomPwd = () => crypto.randomBytes(12).toString('base64url');

const [cmd, arg1, arg2] = process.argv.slice(2);
const users = load();
const name = (arg1 || '').toLowerCase().trim();

switch (cmd) {
  case 'add': {
    if (!name) return fail('usage : node tools/staff.js add <identifiant> [motdepasse]');
    if (users.some(u => u.username === name)) return fail(`Le compte « ${name} » existe déjà.`);
    const pwd = arg2 || randomPwd();
    users.push(makeUser(name, pwd));
    save(users);
    console.log(`Compte créé.\n  identifiant : ${name}\n  mot de passe : ${pwd}`);
    break;
  }
  case 'passwd': {
    if (!name) return fail('usage : node tools/staff.js passwd <identifiant> [motdepasse]');
    const u = users.find(x => x.username === name);
    if (!u) return fail(`Compte « ${name} » introuvable.`);
    const pwd = arg2 || randomPwd();
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPwd(pwd, u.salt);
    save(users);
    console.log(`Mot de passe mis à jour.\n  identifiant : ${name}\n  mot de passe : ${pwd}`);
    break;
  }
  case 'del': {
    if (!name) return fail('usage : node tools/staff.js del <identifiant>');
    const next = users.filter(u => u.username !== name);
    if (next.length === users.length) return fail(`Compte « ${name} » introuvable.`);
    save(next);
    console.log(`Compte « ${name} » supprimé.`);
    break;
  }
  case 'list':
    if (!users.length) console.log('Aucun compte.');
    users.forEach(u => console.log(`- ${u.username}  (créé le ${u.createdAt?.slice(0, 10) || '?'})`));
    break;
  default:
    console.log(`Gestion des comptes du panel staff

  node tools/staff.js add <identifiant> [motdepasse]     créer un compte
  node tools/staff.js passwd <identifiant> [motdepasse]  changer le mot de passe
  node tools/staff.js del <identifiant>                  supprimer un compte
  node tools/staff.js list                               lister les comptes

Sans mot de passe fourni, un mot de passe aléatoire est généré et affiché.`);
}

function fail(msg) { console.error(msg); process.exitCode = 1; }
