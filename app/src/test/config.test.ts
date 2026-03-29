import { getConfig } from '../lib/config';

describe('frontend config', () => {
  it('uses the rotated devnet program ids', () => {
    const config = getConfig();

    expect(config.programIds).toEqual({
      complianceAdmin: 'J6Z2xLJajs627cCpQQGBRqkvPEGE6YkXsx22CTwFkCaF',
      kycRegistry: 'HKAr17WzrUyXudnWb63jxpRtXSEYAFnovv3kVfSKB4ih',
      vusdVault: '2ZrgfkWWHoverBrKXwZsUnmZMaHUFssGipng31jrnn28',
    });
  });
});
