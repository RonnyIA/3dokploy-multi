#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { hashPassword, loadConfig, saveConfig, getDefaultOrgColor } from './storage.ts';

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resetPassword(args: string[]) {
  const config = loadConfig();
  let username = args[0];
  let newPassword = args[1];

  if (!username) {
    const defaultUser = config.admin.username || 'admin';
    const inputUser = await prompt(`Usuario [${defaultUser}]: `);
    username = inputUser || defaultUser;
  }

  if (!newPassword) {
    newPassword = await prompt(`Nueva contraseña para '${username}': `);
    if (!newPassword) {
      console.error('❌ Error: La contraseña no puede estar vacía.');
      process.exit(1);
    }
  }

  const { salt, hash } = hashPassword(newPassword);
  config.admin = {
    username,
    salt,
    hash,
  };
  config.configured = true;

  saveConfig(config);
  console.log(`✅ Contraseña actualizada con éxito para el usuario '${username}'.`);
  console.log('Ahora puedes iniciar sesión en 3Dokploy con estas credenciales.');
}

async function listOrganizations() {
  const config = loadConfig();
  console.log(`\n🏢 Organizaciones configuradas (${config.organizations.length}):`);
  if (config.organizations.length === 0) {
    console.log('  (Ninguna organización configurada)');
    return;
  }

  config.organizations.forEach((org, idx) => {
    const keyPreview = org.apiKey ? `${org.apiKey.substring(0, 6)}...${org.apiKey.slice(-4)}` : 'N/A';
    console.log(`  ${idx + 1}. [${org.id}] ${org.name} | Color: ${org.color} | Key: ${keyPreview}`);
  });
  console.log('');
}

async function addOrganization(args: string[]) {
  const config = loadConfig();
  let name = args[0];
  let apiKey = args[1];
  let color = args[2];

  if (!name) name = await prompt('Nombre de la Organización: ');
  if (!apiKey) apiKey = await prompt('Dokploy API Key: ');
  if (!color) {
    const suggestedColor = getDefaultOrgColor(config.organizations.length);
    const inputColor = await prompt(`Color Hex [${suggestedColor}]: `);
    color = inputColor || suggestedColor;
  }

  if (!name || !apiKey) {
    console.error('❌ Error: Nombre y API Key son obligatorios.');
    process.exit(1);
  }

  const id = `org-${Date.now().toString(36)}`;
  config.organizations.push({
    id,
    name,
    apiKey,
    color,
  });

  saveConfig(config);
  console.log(`✅ Organización '${name}' añadida con éxito (ID: ${id}).`);
}

async function showStatus() {
  const config = loadConfig();
  console.log('\n📊 Estado de 3Dokploy:');
  console.log(`  - Configurado: ${config.configured ? '✅ Sí' : '❌ No (Pendiente Setup)'}`);
  console.log(`  - Usuario Admin: ${config.admin.username || 'No configurado'}`);
  console.log(`  - Dokploy URL: ${config.dokployUrl}`);
  console.log(`  - Organizaciones registradas: ${config.organizations.length}`);
  console.log(`  - Docker Socket local: ${config.useDockerSocket ? '✅ Conectado' : '❌ No detectado'}\n`);
}

async function main() {
  const cmd = process.argv[2] || 'help';
  const args = process.argv.slice(3);

  switch (cmd) {
    case 'reset-password':
    case 'password':
      await resetPassword(args);
      break;

    case 'list-orgs':
    case 'orgs':
      await listOrganizations();
      break;

    case 'add-org':
      await addOrganization(args);
      break;

    case 'status':
      await showStatus();
      break;

    case 'help':
    default:
      console.log(`
🛠️  3Dokploy CLI Tools

Comandos disponibles:
  reset-password [user] [pass]   Resetea la contraseña del administrador
  list-orgs                      Lista las organizaciones configuradas
  add-org [nombre] [apiKey]      Añade una nueva organización
  status                         Muestra el estado de la configuración
      `);
      break;
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
