import { Controller, Post, Body, Request, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { CreateUserDto } from '../users/dto/create-users.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { OtpService } from '../OTP/otp.service';
import { AccountsService } from '../accounts/accounts.service';
import { ApiKeyGuard } from 'src/common/guards/api-key.guard';
import { GetUserId, GetWhatsappAccountId } from 'src/common/decorators';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
    private readonly accountService : AccountsService,
    private readonly whatsappService : WhatsAppService
  ) {}

  @Post('register')
  async register(@Body() createUserDto: CreateUserDto) {
    return this.authService.register(createUserDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('select-account')
  @UseGuards(JwtGuard)
  async selectAccount(@Request() req, @Body('accountId') accountId: string) {
    const userId = req.user.sub;
    return this.authService.selectAccount(userId, accountId);
  }

  @Post('refresh')
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refresh(refreshTokenDto);
  }

  @Post('logout')
  @UseGuards(JwtGuard)
  async logout(@Request() req) {
    const userId = req.user.sub;
    return this.authService.logout(userId);
  }

  @Post('generate-api-key')
  @UseGuards(JwtGuard)
  async generateApiKey(@GetUserId() userId: string) {
    const apiKey = await this.authService.generateApiKey(userId);
    return { apiKey };
  }

  @Post('send-otp')
  @UseGuards(ApiKeyGuard, JwtGuard) // Both guards applied
  async sendOtp(
    @Body() body: { phone_number: string; otp: string }, // Removed userId and accountId from body
    @GetUserId() userId: string,
    @GetWhatsappAccountId() accountId: string,
  ) {
    const { phone_number, otp } = body;

    if (!phone_number || !otp) {
      throw new BadRequestException('Phone number and OTP are required');
    }

    // Fetch clientId
    const clientInfo: { clientId: string; status: string } = await this.accountService.findClientIdByAccountId(
      accountId,
      userId,
    );
    if (!clientInfo || !clientInfo.clientId) {
      throw new BadRequestException('No WhatsApp account found for this user');
    }

    // Store OTP
    await this.otpService.storeOtp(phone_number, otp);

    // Send message using whatsappService
    const message = `Welcome ! Your Code is ${otp}. It expires in 5 minutes.`;
    try {
      await this.whatsappService.sendMessage(clientInfo.clientId, [phone_number], message, 3000);
      return { message: 'OTP sent successfully' };
    } catch (error) {
      console.error(`Failed to send OTP to ${phone_number}: ${error.message}`); // Enhanced logging
      throw new BadRequestException(`Failed to send OTP: ${error.message}`);
    }
  }

}
