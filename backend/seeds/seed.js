// Usage: npm run seed            -> creates the admin account only
//        npm run seed -- --demo  -> also creates a demo PM, customer and project
import bcrypt from 'bcryptjs';
import { config } from '../src/config/environment.js';
import { initDb, db, closeDb } from '../src/config/database.js';
import { runMigrations } from '../src/migrate.js';

export async function seed({ demo = false } = {}) {
  const upsertUser = async (username, fullName, role, password, email) => {
    const found = (await db.query('select id from users where lower(username) = lower($1)', [username])).rows[0];
    if (found) return found.id;
    const hash = await bcrypt.hash(password, 11);
    return (await db.query(
      'insert into users (username, full_name, email, role, password_hash) values ($1,$2,$3,$4,$5) returning id',
      [username, fullName, email, role, hash])).rows[0].id;
  };
  const adminId = await upsertUser('admin', 'Builder Admin', 'ADMIN', config.seedAdminPassword, 'admin@brightlookhomes.in');
  if (demo) {
    const pm = await upsertUser('mahendar', 'Mahendar', 'PROJECT_MANAGER', 'app@123', 'mahendar@brightlookhomes.in');
    const cust = await upsertUser('customer1', 'Ravi Kumar', 'CUSTOMER', 'app@123', 'ravi@example.com');
    const exists = (await db.query("select id from projects where name = 'Ravi Residence'")).rows[0];
    if (!exists) {
      const code = `BLH-${new Date().getFullYear()}-${(await db.query("select nextval('project_code_seq') n")).rows[0].n}`;
      const p = (await db.query(
        `insert into projects (project_code, name, description, location, project_type, contract_amount, start_date, expected_completion_date, status, created_by)
         values ($1,'Ravi Residence','G+1 independent villa','Hyderabad, Telangana','Villa',5000000,current_date,current_date + 365,'IN_PROGRESS',$2) returning id`, [code, adminId])).rows[0];
      await db.query("insert into project_assignments (project_id, user_id, assignment_role, assigned_by) values ($1,$2,'PROJECT_MANAGER',$4),($1,$3,'CUSTOMER',$4)", [p.id, pm, cust, adminId]);
    }
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed.js')) {
  await initDb();
  await runMigrations();
  await seed({ demo: process.argv.includes('--demo') });
  console.log('Seed complete.');
  await closeDb();
}
