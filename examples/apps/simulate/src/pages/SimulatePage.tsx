import React from 'react';
import { ContentLayout } from '../common/components/ContentLayout';
import { SimulateModule } from '../modules/simulatePage/SimulateModule';
import { SimulateHeader } from '../modules/simulatePage/components/SimulateHeader';

const SimulatePage = () => {
  return (
    <ContentLayout>
      <SimulateHeader />
      <SimulateModule />
    </ContentLayout>
  );
};

export default SimulatePage;
