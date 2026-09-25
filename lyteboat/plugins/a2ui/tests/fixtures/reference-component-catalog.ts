/**
 * The reference client's full component catalog (the reference
 * implementation's validator.py), business widgets included: what the
 * golden fixtures were validated against, injected where they are rendered.
 */
import type { A2uiComponentCatalog } from '../../src/contract.ts'

export const REFERENCE_A2UI_COMPONENT_CATALOG: A2uiComponentCatalog = {
  types: [
    'Row', 'Column', 'Card', 'List', 'Table', 'Popup', 'Text', 'RichText', 'Image', 'Icon', 'Tag', 'Circle', 'Divider', 'Line', 'Button',
    'LineChart', 'CandlestickChart', 'Pie', 'IdealRange', 'CollapseList', 'AssetProportionProgress', 'AssetListCard', 'FundFavIcon',
    'EtfFavIcon', 'StockChangeColorText', 'StockKlineCard', 'ProductSelectionList', 'RadarChart', 'ProductCompareChart',
  ],
  bindingFields: {
    Text: ['text'], RichText: ['text'], Image: ['url'], Icon: ['name'], Tag: ['text'], Button: ['text'], List: ['dataSource'],
    CollapseList: ['dataSource', 'expandText', 'foldText'], Pie: ['text'], IdealRange: ['actualValue', 'idealRange'],
    LineChart: ['title', 'dataSource', 'emptyText'], CandlestickChart: ['title', 'dataSource', 'emptyText'], FundFavIcon: ['fundCode'],
    EtfFavIcon: ['productCode'], StockChangeColorText: ['text'], StockKlineCard: ['stockCode', 'stockName', 'market', 'isCommon'],
    ProductSelectionList: ['productList', 'filterConfig', 'headerConfig', 'sortOrder', 'type'], RadarChart: ['series', 'scoreMax', 'legend'],
    ProductCompareChart: ['productCodeList'],
  },
}
