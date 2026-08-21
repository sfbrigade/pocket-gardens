import Base from './base.js';
import { Prisma } from '#prisma/client.js';

export class PlantPhoto extends Base {
  constructor (data) {
    super(Prisma.PlantPhotoScalarFieldEnum, data);
  }

  get fileUrl () {
    return this.getAssetUrl('file');
  }
}

export default PlantPhoto;
