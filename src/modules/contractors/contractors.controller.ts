import { Controller, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('contractors')
@UseGuards(JwtAuthGuard)
export class UcontractorsController {
  // TODO: implement contractors endpoints
}
