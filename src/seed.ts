import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UsersService } from './modules/users/users.service';
import { UserRole } from './common/enum/user_role'; // <--- Corrected path

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);

  // Seed a normal user
  const normalUser = await usersService.createUser({
    username: 'normaluser',
    email: 'normaluser@example.com',
    password: 'normalpassword123',
    userRole: UserRole.USER,
  });
  console.log('Normal user created:', normalUser.email);

  // Seed an admin user
  const adminUser = await usersService.createUser({
    username: 'adminuser',
    email: 'admin@example.com',
    password: 'adminpassword123',
    userRole: UserRole.ADMIN,
  });
  console.log('Admin user created:', adminUser.email);

  await app.close();
  console.log('Seeding complete.');
}

bootstrap();