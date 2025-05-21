import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

@ValidatorConstraint({ name: 'isValidPhoneNumbers', async: false })
export class IsValidPhoneNumbers implements ValidatorConstraintInterface {
  validate(to: string[], args: ValidationArguments) {
    if (!Array.isArray(to) || to.length === 0) {
      return false;
    }

    const phoneNumberRegex = /^\+?\d{9,15}$/;
    return to.every((value) => phoneNumberRegex.test(value));
  }

  defaultMessage(args: ValidationArguments) {
    return 'to must contain valid phone numbers (9-15 digits, optional +)';
  }
}