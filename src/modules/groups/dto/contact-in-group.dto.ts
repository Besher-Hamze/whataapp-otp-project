import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class ContactInGroupDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @Matches(/^\d+$/, {
    message: 'Phone number must contain digits only.',
  })
  phone_number: string;
}
