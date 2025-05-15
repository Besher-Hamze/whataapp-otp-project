import { Injectable, UnauthorizedException, InternalServerErrorException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-users.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Token } from './schema/refresh-token.schema';
import { AccountsService } from '../accounts/accounts.service';
import { UserDocument } from '../users/schema/users.schema'; // Update import
import { AccountDocument } from '../accounts/schema/account.schema'; // Update import

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectModel(Token.name) private tokenModel: Model<Token>,
    private readonly accountService: AccountsService,
  ) {
    if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET or JWT_REFRESH_SECRET is not defined');
    }
  }

  async register(createUserDto: CreateUserDto): Promise<{ user: UserDocument; access_token: string; refresh_token: string }> { // Update return type
    const newUser = await this.usersService.createUser(createUserDto);

    const payload = { sub: newUser._id, email: newUser.email };
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '1d',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    try {
      await Promise.all([
        this.tokenModel.create({
          userId: newUser._id,
          token: accessToken,
          type: 'access',
          expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        }),
        this.tokenModel.create({
          userId: newUser._id,
          token: refreshToken,
          type: 'refresh',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      ]);
    } catch (error) {
      this.logger.error(`Failed to save tokens: ${error.message}`);
      throw new InternalServerErrorException('Failed to process registration');
    }

    return {
      user: newUser,
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string; refresh_token: string }> {
    const { email, password } = loginDto;
    const user = await this.usersService.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.usersService.comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user._id, email: user.email };
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '1d',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    try {
      await Promise.all([
        this.tokenModel.create({
          userId: user._id,
          token: accessToken,
          type: 'access',
          expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        }),
        this.tokenModel.create({
          userId: user._id,
          token: refreshToken,
          type: 'refresh',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      ]);
    } catch (error) {
      this.logger.error(`Failed to save tokens: ${error.message}`);
      throw new InternalServerErrorException('Failed to process login');
    }

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async selectAccount(userId: string, accountId: string): Promise<{ access_token: string; refresh_token: string }> {
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const account = await this.accountService.findAccountById(accountId);
    if (!account || account.user.toString() !== user._id.toString()) {
      throw new UnauthorizedException('Invalid or unauthorized account');
    }

    const payload = { sub: user._id, email: user.email, account_id: account._id.toString() };
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '1d',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });

    try {
      const tokenRecord = await this.tokenModel.findOne({ userId, type: 'refresh' });
      if (tokenRecord) {
        await this.tokenModel.updateOne(
          { _id: tokenRecord._id },
          { token: refreshToken, accountId: account._id.toString(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        );
        await this.tokenModel.deleteMany({ userId, type: 'refresh', _id: { $ne: tokenRecord._id } });
        await this.tokenModel.create({
          userId: user._id,
          token: accessToken,
          type: 'access',
          accountId: account._id.toString(),
          expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        });
      } else {
        await Promise.all([
          this.tokenModel.create({
            userId: user._id,
            token: accessToken,
            type: 'access',
            accountId: account._id.toString(),
            expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
          }),
          this.tokenModel.create({
            userId: user._id,
            token: refreshToken,
            type: 'refresh',
            accountId: account._id.toString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }),
        ]);
      }
    } catch (error) {
      this.logger.error(`Failed to update tokens with account: ${error.message}`);
      throw new InternalServerErrorException('Failed to select account');
    }

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async logout(userId: string): Promise<{ message: string }> {
    try {
      await this.tokenModel.deleteMany({ userId });
      return { message: 'Successfully logged out' };
    } catch (error) {
      this.logger.error(`Failed to logout: ${error.message}`);
      throw new InternalServerErrorException('Failed to process logout');
    }
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<{ access_token: string; refresh_token: string }> {
    const { refresh_token } = refreshTokenDto;
    try {
      const payload = this.jwtService.verify(refresh_token, {
        secret: process.env.JWT_REFRESH_SECRET,
      });

      const tokenRecord = await this.tokenModel.findOne({
        userId: payload.sub,
        token: refresh_token,
        type: 'refresh',
        expiresAt: { $gt: new Date() },
      });

      if (!tokenRecord) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const user = await this.usersService.findUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newPayload = { sub: user._id, email: user.email, account_id: tokenRecord.accountId || undefined };
      const accessToken = this.jwtService.sign(newPayload, {
        secret: process.env.JWT_SECRET,
        expiresIn: '1d',
      });
      const newRefreshToken = this.jwtService.sign(newPayload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      });

      try {
        await Promise.all([
          this.tokenModel.create({
            userId: user._id,
            token: accessToken,
            type: 'access',
            accountId: tokenRecord.accountId,
            expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
          }),
          this.tokenModel.updateOne(
            { _id: tokenRecord._id },
            {
              token: newRefreshToken,
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              accountId: tokenRecord.accountId,
            },
          ),
        ]);
        await this.tokenModel.deleteMany({ userId: payload.sub, type: 'refresh', _id: { $ne: tokenRecord._id } });
      } catch (error) {
        this.logger.error(`Failed to update tokens: ${error.message}`);
        throw new InternalServerErrorException('Failed to refresh token');
      }

      return { access_token: accessToken, refresh_token: newRefreshToken };
    } catch (error) {
      this.logger.error(`Refresh token verification failed: ${error.message}`);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}