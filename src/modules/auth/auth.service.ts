import { Injectable, UnauthorizedException, InternalServerErrorException, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
import { v4 as uuidv4 } from 'uuid';
import { ApiKey } from '../OTP/schema/api-key.schema';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectModel(Token.name) private tokenModel: Model<Token>,
    private readonly accountService: AccountsService,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKey>
  ) {
    if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET or JWT_REFRESH_SECRET is not defined');
    }
  }

  async register(createUserDto: CreateUserDto): Promise<{ user: UserDocument; access_token: string; refresh_token: string }> { // Update return type
    const newUser = await this.usersService.createUser(createUserDto);

    const payload = { sub: newUser._id, email: newUser.email , role: newUser.userRole };
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

async login(loginDto: LoginDto): Promise<{ access_token: string; refresh_token: string; message: string }> {
  const { email, password } = loginDto;
  this.logger.log(`Starting login process for email: ${email}`);

  // Validate user credentials
  this.logger.debug(`Fetching user with email: ${email}`);
  const user = await this.usersService.findUserByEmail(email);
  if (!user) {
    this.logger.warn(`User not found for email: ${email}`);
    throw new UnauthorizedException('Invalid credentials');
  }
  this.logger.debug(`Found user: ${user.email} (userId: ${user._id})`);

  this.logger.debug(`Validating password for user: ${user.email}`);
  const isPasswordValid = await this.usersService.comparePassword(password, user.password);
  if (!isPasswordValid) {
    this.logger.warn(`Invalid password attempt for user: ${user.email}`);
    throw new UnauthorizedException('Invalid credentials');
  }
  this.logger.log(`Password validated successfully for user: ${user.email}`);

  // Generate fallback tokens without account_id
  this.logger.debug(`Generating fallback tokens without account_id for user: ${user.email}`);
  const payload = { 
  sub: user._id, 
  email: user.email,
  userRole: user.userRole // ✅ Add this line
};
  let accessToken = this.jwtService.sign(payload, {
    secret: process.env.JWT_SECRET,
    expiresIn: '1d',
  });
  let refreshToken = this.jwtService.sign(payload, {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d',
  });

  try {
    this.logger.debug(`Saving fallback tokens for userId: ${user._id}`);
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
    this.logger.log(`Fallback tokens saved successfully for user: ${user.email}`);
  } catch (error) {
    this.logger.error(`Failed to save fallback tokens for userId: ${user._id}: ${error.message}`, error.stack);
    throw new InternalServerErrorException('Failed to process login');
  }

  let message = 'No default account selected';

  // Attempt to fetch and select a default account
  this.logger.debug(`Attempting to fetch accounts for userId: ${user._id}`);
  try {
    const accounts = await this.accountService.findAccountsByUser(user._id.toString());
    this.logger.log(`Found ${accounts.length} account(s) for userId: ${user._id}`);

    if (accounts.length > 0) {
      const defaultAccount = accounts[0];
      this.logger.log(`Selecting first account as default: ${defaultAccount._id} (phone: ${defaultAccount.phone_number || 'unknown'})`);
      const tokenResponse = await this.selectAccount(user._id.toString(), defaultAccount._id.toString());
      accessToken = tokenResponse.access_token;
      refreshToken = tokenResponse.refresh_token;
      message = `Default account selected: ${defaultAccount._id}`;
      this.logger.log(`Tokens updated with account_id: ${defaultAccount._id} for user: ${user.email}`);
    }
  } catch (error) {
    if (error instanceof NotFoundException) {
      this.logger.warn(`No accounts found for userId: ${user._id}, proceeding with fallback tokens`);
    } else {
      this.logger.error(`Error fetching accounts for userId: ${user._id}: ${error.message}`, error.stack);
      this.logger.warn(`Falling back to fallback tokens for user: ${user.email}`);
    }
  }

  this.logger.log(`Login successful for user: ${user.email}, message: ${message}`);
  return { access_token: accessToken, refresh_token: refreshToken, message };
}

  async selectAccount(userId: string, accountId: string): Promise<{ access_token: string; refresh_token: string }> {
    this.logger.log(`Starting selectAccount for userId: ${userId}, accountId: ${accountId}`);

    // Retrieve user
    this.logger.debug(`Fetching user with userId: ${userId}`);
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      this.logger.warn(`User not found for userId: ${userId}`);
      throw new UnauthorizedException('User not found');
    }
    this.logger.debug(`Found user: ${user.email} (userId: ${userId})`);

    // Retrieve and validate account
    this.logger.debug(`Fetching account with accountId: ${accountId}`);
    const account = await this.accountService.findAccountById(accountId);
    if (!account || account.user.toString() !== user._id.toString()) {
      this.logger.warn(
        `Invalid or unauthorized account for accountId: ${accountId}, userId: ${userId}`,
      );
      throw new UnauthorizedException('Invalid or unauthorized account');
    }
    this.logger.debug(`Found account: ${account.phone_number || 'unknown'} (accountId: ${accountId})`);

    // Generate JWT tokens
    this.logger.debug(`Generating JWT tokens for userId: ${userId}, accountId: ${accountId}`);
    const payload = { sub: user._id, email: user.email, account_id: account._id.toString() };
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '1d',
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: '7d',
    });
    this.logger.debug(`Generated access and refresh tokens for userId: ${userId}`);

    // Update or create token records
    this.logger.debug(`Updating token records for userId: ${userId}, accountId: ${accountId}`);
    try {
      const tokenRecord = await this.tokenModel.findOne({ userId, type: 'refresh' });
      if (tokenRecord) {
        this.logger.debug(`Found existing refresh token for userId: ${userId}`);
        await this.tokenModel.updateOne(
          { _id: tokenRecord._id },
          {
            token: refreshToken,
            accountId: account._id.toString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        );
        this.logger.debug(`Updated refresh token for userId: ${userId}`);
        await this.tokenModel.deleteMany({
          userId,
          type: 'refresh',
          _id: { $ne: tokenRecord._id },
        });
        this.logger.debug(`Deleted old refresh tokens for userId: ${userId}`);
        await this.tokenModel.create({
          userId: user._id,
          token: accessToken,
          type: 'access',
          accountId: account._id.toString(),
          expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        });
        this.logger.debug(`Created new access token for userId: ${userId}`);
      } else {
        this.logger.debug(`No existing refresh token found for userId: ${userId}`);
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
        this.logger.debug(`Created new access and refresh tokens for userId: ${userId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update tokens for userId: ${userId}, accountId: ${accountId}: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to select account');
    }

    this.logger.log(
      `Successfully selected account for userId: ${userId}, accountId: ${accountId}`,
    );
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

  async generateApiKey(userId: string): Promise<string> {
    // Fetch an active accountId for the user (e.g., the first active account)
    const accounts = await this.accountService.findAccountsByUser(userId);
    if (!accounts || accounts.length === 0) {
      throw new BadRequestException('No active accounts found for this user');
    }
    const accountId = accounts[0]._id.toString(); // Use the first account, or implement logic to select one

    const apiKey = uuidv4();
    await this.apiKeyModel.create({
      key: apiKey,
      userId,
      accountId,
      isActive: true,
      createdAt: new Date(),
    });

    return apiKey;
  }

  async removeAccountFromTokens(userId: string, accountId: string): Promise<void> {
  this.logger.log(`Removing account ${accountId} from tokens for userId: ${userId}`);

  // Find all tokens associated with the deleted accountId
  const tokens = await this.tokenModel.find({ userId, accountId }).exec();
  if (!tokens || tokens.length === 0) {
    this.logger.debug(`No tokens found for accountId: ${accountId}, userId: ${userId}`);
    return;
  }

  // Fetch the user to generate new tokens
  const user = await this.usersService.findUserById(userId);
  if (!user) {
    this.logger.warn(`User not found for userId: ${userId}, skipping token regeneration`);
    return;
  }

  // Generate new payload without account_id
  const newPayload = { sub: user._id, email: user.email };
  const accessToken = this.jwtService.sign(newPayload, {
    secret: process.env.JWT_SECRET,
    expiresIn: '1d',
  });
  const refreshToken = this.jwtService.sign(newPayload, {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d',
  });

  // Update or create new token records without accountId
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

    // Delete old tokens with the deleted accountId
    await this.tokenModel.deleteMany({ userId, accountId });
    this.logger.log(`Successfully regenerated tokens and removed account ${accountId} for userId: ${userId}`);
  } catch (error) {
    this.logger.error(`Failed to regenerate tokens for userId: ${userId}, accountId: ${accountId}: ${error.message}`);
    throw new InternalServerErrorException('Failed to update tokens after account deletion');
  }

  // Invalidate API keys with the deleted accountId
  const apiKeys = await this.apiKeyModel.find({ accountId, isActive: true }).exec();
  if (apiKeys.length > 0) {
    await this.apiKeyModel.updateMany({ accountId }, { isActive: false });
    this.logger.log(`Invalidated ${apiKeys.length} API keys for accountId: ${accountId}`);
  }
}
}