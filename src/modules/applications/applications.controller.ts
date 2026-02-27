import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class UapplicationsController {
  // TODO: implement applications endpoints
}
