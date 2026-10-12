import type { Locale } from './locales';

/**
 * Phase 8 P8-17 (Owner OQ-P8-7): texts of the review card on the customer's paid-invoice page. Short, warm and plain: the customer is told in the
 * first lines that the review is private (used inside the spa only, never posted) and that it can be skipped. Lucy Spa is a spa: never "khám".
 */
interface Words {
  title: string;
  intro: string;
  ratingLabel: string;
  scale: string;
  point: string;
  commentLabel: string;
  commentHint: string;
  commentPlaceholder: string;
  staffTitle: string;
  staffIntro: string;
  staffSkip: string;
  submit: string;
  submitting: string;
  later: string;
  thanksTitle: string;
  thanksText: string;
  yourRating: string;
  staffGiven: string;
  stars: string;
  errors: { already: string; unavailable: string; invalid: string; generic: string };
}

const vi: Words = {
  title: 'Đánh giá của bạn',
  intro:
    'Cho Lucy Spa biết bạn thấy thế nào về lần này. Chỉ chúng tôi đọc, không đăng công khai. Bạn có thể bỏ qua.',
  ratingLabel: 'Bạn hài lòng đến mức nào?',
  scale: '1 là chưa hài lòng, 5 là rất hài lòng.',
  point: '{n} sao',
  commentLabel: 'Điều bạn muốn nhắn',
  commentHint: 'Không bắt buộc. Tối đa {max} ký tự.',
  commentPlaceholder: 'Ví dụ: không gian yên tĩnh, bạn kỹ thuật viên nhẹ nhàng…',
  staffTitle: 'Chấm riêng từng người',
  staffIntro: 'Không bắt buộc. Chọn “Bỏ qua” nếu bạn không muốn chấm.',
  staffSkip: 'Bỏ qua',
  submit: 'Gửi đánh giá',
  submitting: 'Đang gửi…',
  later: 'Để sau',
  thanksTitle: 'Cảm ơn bạn đã đánh giá',
  thanksText: 'Lucy Spa đã nhận được ý kiến của bạn. Chúng tôi chỉ dùng để làm dịch vụ tốt hơn.',
  yourRating: 'Bạn chấm',
  staffGiven: 'Bạn chấm riêng',
  stars: '{n}/5 sao',
  errors: {
    already: 'Hóa đơn này đã được đánh giá rồi.',
    unavailable: 'Hóa đơn này chưa thể đánh giá.',
    invalid: 'Vui lòng chọn số sao và kiểm tra lại nội dung.',
    generic: 'Chưa gửi được đánh giá. Vui lòng thử lại.',
  },
};

const en: Words = {
  title: 'Your review',
  intro:
    'Tell Lucy Spa how this visit was. Only we read it and it is never posted. You can skip it.',
  ratingLabel: 'How happy were you?',
  scale: '1 is not happy, 5 is very happy.',
  point: '{n} stars',
  commentLabel: 'Anything you would like to say',
  commentHint: 'Optional. Up to {max} characters.',
  commentPlaceholder: 'For example: a quiet room, a gentle therapist…',
  staffTitle: 'Rate each person',
  staffIntro: 'Optional. Choose “Skip” if you would rather not rate.',
  staffSkip: 'Skip',
  submit: 'Send review',
  submitting: 'Sending…',
  later: 'Not now',
  thanksTitle: 'Thank you for your review',
  thanksText: 'Lucy Spa has your feedback. We only use it to make the service better.',
  yourRating: 'Your rating',
  staffGiven: 'Your ratings of people',
  stars: '{n}/5 stars',
  errors: {
    already: 'This invoice was already reviewed.',
    unavailable: 'This invoice cannot be reviewed yet.',
    invalid: 'Please choose a number of stars and check your note.',
    generic: 'The review was not sent. Please try again.',
  },
};

export function reviewDictionary(locale: Locale): Words {
  return locale === 'en' ? en : vi;
}

export type ReviewDictionary = Words;
