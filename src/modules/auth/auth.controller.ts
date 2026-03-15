import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { IsEmail, IsString, MinLength } from 'class-validator';

class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    password: string;
}

class SignupDto {
    @IsEmail()
    email: string;

    @IsString()
    name: string;

    @IsString()
    @MinLength(8)
    password: string;
}

class VerifyOtpDto {
    @IsEmail()
    email: string;

    @IsString()
    otp: string;
}

class RefreshDto {
    @IsString()
    refresh_token: string;
}

export class AcceptInviteDto {
    @IsEmail()
    email: string;

    @IsString()
    token: string;

    @IsString()
    @MinLength(8)
    password: string;
}

@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) { }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() dto: LoginDto) {
        const user = await this.authService.validateUser(dto.email, dto.password);
        return this.authService.login(user);
    }

    @Post('signup')
    @HttpCode(HttpStatus.OK)
    async signup(@Body() dto: SignupDto) {
        return this.authService.signup(dto.email, dto.name, dto.password);
    }

    @Post('verify-otp')
    @HttpCode(HttpStatus.OK)
    async verifyOtp(@Body() dto: VerifyOtpDto) {
        return this.authService.verifyOtp(dto.email, dto.otp);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(@Body() dto: RefreshDto) {
        return this.authService.refreshToken(dto.refresh_token);
    }

    @Post('accept-invite')
    @HttpCode(HttpStatus.OK)
    async acceptInvite(@Body() dto: AcceptInviteDto) {
        return this.authService.acceptInvite(dto.email, dto.token, dto.password);
    }
}
