import { pool } from './client'
import bcrypt from 'bcryptjs'

async function seedAdmin() {
  const email = 'admin@ocar.com'
  const password = 'Admin@1234'
  const role = 'super_admin'

  const hash = await bcrypt.hash(password, 12)

  const query = `
    INSERT INTO admins (email, password_hash, role, is_active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (email) DO NOTHING
    RETURNING id, code, email, role;
  `

  const result = await pool.query(query, [email, hash, role])

  if (result.rows.length > 0) {
    console.log('Admin seeded successfully:')
    console.log(result.rows[0])
  } else {
    console.log('Admin already exists — skipped')
  }

  await pool.end()
}

seedAdmin().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
