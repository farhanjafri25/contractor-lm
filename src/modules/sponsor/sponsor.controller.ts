import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('sponsor')
@UseGuards(JwtAuthGuard)
export class SponsorController {
  // TODO: implement sponsor action endpoints
}
