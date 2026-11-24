-- Add an administrative role without altering any existing users.
ALTER TYPE "TipoUsuario" ADD VALUE IF NOT EXISTS 'ADMIN';
