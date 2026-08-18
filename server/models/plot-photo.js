import Base from './base.js';
import { Prisma } from '#prisma/client.js';

export class PlotPhoto extends Base {
  constructor (data) {
    super(Prisma.PlotPhotoScalarFieldEnum, data);
  }

  get fileUrl () {
    return this.getAssetUrl('file');
  }
}

export default PlotPhoto;
