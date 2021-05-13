import {
  getCurrentInstance,
  ref,
  computed,
  reactive,
  provide,
  resolveDirective,
  resolveDynamicComponent,
  withDirectives
} from "vue";
import _ from "lodash-es";
import FsRowHandle from "./fs-row-handle.vue";
import FsComponentRender from "../render/fs-component-render";
import "./fs-table.less";
import { uiContext } from "../../ui";
import { useCompute } from "../../use/use-compute";
import { useEditable } from "./editable/use-editable";

/**
 * table封装
 * 支持el-table/a-table的参数
 */
export default {
  name: "FsTable",
  components: { FsComponentRender, FsRowHandle },
  props: {
    /**
     * table插槽
     */
    slots: {},
    /**
     * 单元格插槽
     */
    cellSlots: {},
    /**
     * 列配置，支持el-table-column|a-table-column配置
     */
    columns: {
      type: Array,
      default: undefined
    },
    /**
     * 操作列
     */
    rowHandle: {},
    /**
     * 是否显示表格
     */
    show: {},
    /**
     * 表格数据
     */
    data: {},

    /**
     * 行编辑，批量编辑
     */
    editable: {}
  },
  emits: ["row-handle", "value-change"],
  setup(props, ctx) {
    const tableRef = ref();
    const componentRefs = ref([]);
    const getComponentRef = (index, key) => {
      if (!key || index == null || index > componentRefs.value.length) {
        return;
      }
      const row = componentRefs.value[index];
      const cellRef = row[key];
      return cellRef.getTargetRef();
    };

    const { doComputed } = useCompute();
    const computedColumns = doComputed(props.columns, null, [/\[.+\]component/]);

    return {
      tableRef,
      componentRefs,
      getComponentRef,
      computedColumns,
      ...useEditable(props, ctx, tableRef)
    };
  },
  methods: {
    onRowHandle(context) {
      this.$emit("row-handle", context);
    }
  },
  render() {
    if (this.show === false) {
      return;
    }
    const ui = uiContext.get();
    const { proxy } = getCurrentInstance();
    const tableComp = resolveDynamicComponent(proxy.$fsui.table.name);

    const tableSlots = {};

    const templateMode = true;
    const tableColumnCI = proxy.$fsui.tableColumn;
    if (templateMode) {
      const tableColumnComp = resolveDynamicComponent(tableColumnCI.name);
      const tableColumnGroupComp = resolveDynamicComponent(proxy.$fsui.tableColumnGroup.name);

      const getContextFn = (item, scope) => {
        const row = scope[tableColumnCI.row];
        const form = row;
        const getComponentRef = (key) => {
          const index = scope[ui.tableColumn.index];
          return this.getComponentRef(index, key);
        };
        return {
          ...scope,
          key: item.key,
          value: row[item.key],
          row,
          form,
          getComponentRef
        };
      };

      tableSlots.default = () => {
        const children = [];
        const buildColumn = (item) => {
          let cellSlots = {};
          let currentTableColumnComp = tableColumnComp;
          const cellSlotName = "cell_" + item.key;
          if (item.children && item.children.length > 0) {
            cellSlots.default = () => {
              const subColumns = [];
              _.forEach(item.children, (subColumn) => {
                if (subColumn.show === false) {
                  return;
                }
                subColumns.push(buildColumn(subColumn));
              });
              return subColumns;
            };
            currentTableColumnComp = tableColumnGroupComp;
          } else if (this.cellSlots && this.cellSlots[cellSlotName]) {
            cellSlots.default = (scope) => {
              scope.row = scope[tableColumnCI.row];
              return this.cellSlots[cellSlotName](scope);
            };
          } else if (item.component) {
            cellSlots.default = (scope) => {
              scope.row = scope[tableColumnCI.row];
              const getScopeFn = () => {
                return getContextFn(item, scope);
              };
              const vModel = {
                modelValue: scope[tableColumnCI.row][item.key] || null,
                "onUpdate:modelValue": (value) => {
                  scope[tableColumnCI.row][item.key] = value;
                  const newScope = getContextFn(item, scope);
                  this.$emit("value-change", newScope);
                  const key = newScope.key;
                  for (let column of this.columns) {
                    if (column.key === key) {
                      if (column.valueChange) {
                        column.valueChange(newScope);
                      }
                      break;
                    }
                  }
                }
              };
              const setRef = (el) => {
                const index = scope[ui.tableColumn.index];
                const key = item.key;
                let rowRefs = this.componentRefs[index];
                if (rowRefs == null) {
                  this.componentRefs[index] = rowRefs = {};
                }
                rowRefs[key] = el;
              };

              const index = scope[ui.tableColumn.index];
              if (this.editable) {
                return (
                  <fs-editable-cell
                    ref={setRef}
                    columnKey={item.key}
                    index={index}
                    component={item.component}
                    getScope={getScopeFn}
                    {...vModel}
                  />
                );
              } else {
                return <fs-cell ref={setRef} component={item.component} getScope={getScopeFn} {...vModel} />;
              }
            };
          } else if (item.formatter) {
            cellSlots.default = (scope) => {
              const newScope = getContextFn(item, scope);
              return item.formatter(newScope);
            };
          } else {
            cellSlots = null;
          }
          const newItem = { ...item };
          delete newItem.children;

          return (
            <currentTableColumnComp
              ref={"tableColumnRef"}
              {...newItem}
              label={item.title}
              prop={item.key}
              dataIndex={item.key}
              v-slots={cellSlots}
            />
          );
        };
        _.forEach(this.columns, (item) => {
          if (item.show === false) {
            return;
          }
          children.push(buildColumn(item));
        });

        // rowHandle
        if (this.rowHandle && this.rowHandle.show !== false) {
          const rowHandleSlots = {
            default: (scope) => {
              return <fs-row-handle {...this.rowHandle} scope={scope} onHandle={this.onRowHandle} />;
            }
          };
          children.push(
            <tableColumnComp
              ref={"tableColumnRef"}
              {...this.rowHandle}
              label={this.rowHandle.title}
              prop={this.rowHandle.key || "rowHandle"}
              v-slots={rowHandleSlots}
            />
          );
        }
        return children;
      };
    }
    const dataSource = {
      [proxy.$fsui.table.data]: this.data
    };

    if (this.slots) {
      _.forEach(this.slots, (item, key) => {
        tableSlots[key] = item;
      });
    }

    const tableRender = <tableComp ref={"tableRef"} {...this.$attrs} {...dataSource} v-slots={tableSlots} />;
    if (proxy.$fsui.table.vLoading) {
      const loading = resolveDirective(proxy.$fsui.table.vLoading);
      return withDirectives(tableRender, [[loading, this.$attrs.loading]]);
    }
    return tableRender;
  }
};
