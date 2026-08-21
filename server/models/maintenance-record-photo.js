import Base from './base.js';
import { Prisma } from '#prisma/client.js';

export class MaintenanceRecordPhoto extends Base {
  constructor (data) {
    super(Prisma.MaintenanceRecordPhotoScalarFieldEnum, data);
  }

  get fileUrl () {
    return this.getAssetUrl('file');
  }
}

export default MaintenanceRecordPhoto;
