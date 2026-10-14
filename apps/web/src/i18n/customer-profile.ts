import type { Locale } from './locales';

/**
 * Session 7b: texts of the customer's own profile ("Hồ sơ"): edit the name, change the sign-in email through a code sent to the
 * new address. Phone and birthday are shown only. Plain, short Vietnamese; an error names the fix (DESIGN.md H12, H14). Never "khám".
 */
const vi = {
  personalTitle: 'Thông tin cá nhân',
  edit: 'Sửa',
  editTitle: 'Sửa thông tin cá nhân',
  save: 'Lưu thay đổi',
  saving: 'Đang lưu…',
  saved: 'Đã lưu họ và tên.',
  phone: 'Số điện thoại',
  birthday: 'Ngày sinh',
  managedNote:
    'Số điện thoại và ngày sinh do Lucy Spa quản lý. Cần thay đổi? Hãy liên hệ spa để được hỗ trợ.',
  nameHint: 'Tên dùng trên lịch hẹn và hóa đơn của bạn.',
  nameRequired: 'Hãy nhập họ và tên.',
  nameTooLong: 'Họ và tên tối đa 200 ký tự.',
  nameInvalid: 'Họ và tên chưa hợp lệ. Hãy bỏ ký tự xuống dòng hoặc ký tự lạ.',
  stale: 'Hồ sơ vừa được cập nhật ở nơi khác. Hãy xem lại thông tin rồi lưu lại.',
  emailTitle: 'Email đăng nhập',
  emailLabel: 'Email',
  emailVerified: 'Đã xác minh',
  emailUnverified: 'Chưa xác minh',
  changeEmail: 'Đổi email',
  changeEmailTitle: 'Đổi email đăng nhập',
  changeEmailIntro:
    'Nhập mật khẩu hiện tại và email mới. Email chỉ đổi sau khi bạn nhập đúng mã gửi đến địa chỉ mới.',
  currentPassword: 'Mật khẩu hiện tại',
  newEmail: 'Email mới',
  sendCode: 'Gửi mã',
  sendingCode: 'Đang gửi…',
  code: 'Mã xác minh (6 số)',
  verify: 'Xác minh',
  verifying: 'Đang xác minh…',
  resend: 'Gửi lại mã',
  codeSent: 'Mã đã được gửi đến {email}. Mã có hiệu lực trong vài phút.',
  resent: 'Đã gửi lại mã đến {email}.',
  emailChanged: 'Đã đổi email đăng nhập thành {email}.',
  passwordRequired: 'Hãy nhập mật khẩu hiện tại.',
  emailRequired: 'Hãy nhập email mới.',
  invalidEmail: 'Email chưa đúng định dạng, ví dụ ten@example.com.',
  sameEmail: 'Email mới đang giống email hiện tại. Hãy nhập một địa chỉ khác.',
  emailTaken: 'Email này đã được dùng cho một tài khoản khác. Hãy nhập địa chỉ khác.',
  wrongPassword: 'Mật khẩu hiện tại chưa đúng. Hãy thử lại.',
  codeRequired: 'Hãy nhập mã gồm 6 số.',
  badCode: 'Mã chưa đúng hoặc đã hết hạn. Hãy thử lại hoặc gửi lại mã.',
  discardTitle: 'Bỏ thay đổi?',
  discardBody: 'Những gì bạn vừa nhập sẽ không được lưu.',
  discardConfirm: 'Bỏ thay đổi',
  discardKeep: 'Tiếp tục sửa',
};

const en: typeof vi = {
  personalTitle: 'Personal details',
  edit: 'Edit',
  editTitle: 'Edit personal details',
  save: 'Save changes',
  saving: 'Saving…',
  saved: 'Your name was saved.',
  phone: 'Phone number',
  birthday: 'Date of birth',
  managedNote:
    'Lucy Spa manages your phone number and date of birth. Need a change? Contact the spa and we will help.',
  nameHint: 'The name used on your bookings and invoices.',
  nameRequired: 'Enter your full name.',
  nameTooLong: 'Your full name can have at most 200 characters.',
  nameInvalid: 'This name is not valid. Remove any line breaks or unusual characters.',
  stale: 'Your profile was just updated somewhere else. Check the details, then save again.',
  emailTitle: 'Sign-in email',
  emailLabel: 'Email',
  emailVerified: 'Verified',
  emailUnverified: 'Not verified',
  changeEmail: 'Change email',
  changeEmailTitle: 'Change sign-in email',
  changeEmailIntro:
    'Enter your current password and the new email. The email only changes after you enter the code sent to the new address.',
  currentPassword: 'Current password',
  newEmail: 'New email',
  sendCode: 'Send code',
  sendingCode: 'Sending…',
  code: 'Verification code (6 digits)',
  verify: 'Verify',
  verifying: 'Verifying…',
  resend: 'Send a new code',
  codeSent: 'A code was sent to {email}. It is valid for a few minutes.',
  resent: 'A new code was sent to {email}.',
  emailChanged: 'Your sign-in email is now {email}.',
  passwordRequired: 'Enter your current password.',
  emailRequired: 'Enter the new email.',
  invalidEmail: 'This email is not in the right format, for example name@example.com.',
  sameEmail: 'The new email is the same as the current one. Enter a different address.',
  emailTaken: 'This email is already used by another account. Enter a different address.',
  wrongPassword: 'The current password is not correct. Try again.',
  codeRequired: 'Enter the 6-digit code.',
  badCode: 'The code is wrong or expired. Try again or send a new code.',
  discardTitle: 'Discard changes?',
  discardBody: 'What you entered will not be saved.',
  discardConfirm: 'Discard',
  discardKeep: 'Keep editing',
};

export type CustomerProfileDictionary = typeof vi;

export function customerProfileDictionary(locale: Locale): CustomerProfileDictionary {
  return locale === 'vi' ? vi : en;
}
