import * as React from "react";
import type { GlobalState } from "./globalState";

import { NodeListComponent } from "./components/nodeList/nodeListComponent";
import { PropertyTabComponent } from "./components/propertyTab/propertyTabComponent";
import { Portal } from "./portal";
import { LogComponent, LogEntry } from "./components/log/logComponent";
import { DataStorage } from "core/Misc/dataStorage";
import type { Nullable } from "core/types";
import { MessageDialog } from "shared-ui-components/components/MessageDialog";
import { BlockTools } from "./blockTools";
import { PreviewManager } from "./components/preview/previewManager";
import { PreviewMeshControlComponent } from "./components/preview/previewMeshControlComponent";
import { PreviewAreaComponent } from "./components/preview/previewAreaComponent";
import { SerializationTools } from "./serializationTools";
import * as ReactDOM from "react-dom";
import type { IInspectorOptions } from "core/Debug/debugLayer";
import { Popup } from "./sharedComponents/popup";

import "./main.scss";
import { GraphCanvasComponent } from "shared-ui-components/nodeGraphSystem/graphCanvas";
import type { GraphNode } from "shared-ui-components/nodeGraphSystem/graphNode";
import { TypeLedger } from "shared-ui-components/nodeGraphSystem/typeLedger";
import type { IEditorData } from "shared-ui-components/nodeGraphSystem/interfaces/nodeLocationInfo";
import type { INodeData } from "shared-ui-components/nodeGraphSystem/interfaces/nodeData";
import { NodeRenderGraphBlock } from "core/FrameGraph/Node/nodeRenderGraphBlock";
import { NodeRenderGraphOutputBlock } from "core/FrameGraph/Node/Blocks/outputBlock";
import type { NodeRenderGraphBlockConnectionPointTypes } from "core/FrameGraph/Node/Types/nodeRenderGraphTypes";
import { NodeRenderGraphInputBlock } from "core/FrameGraph/Node/Blocks/inputBlock";
import type { RenderTargetWrapper } from "core/Engines/renderTargetWrapper";
import { Constants } from "core/Engines/constants";

interface IGraphEditorProps {
    globalState: GlobalState;
}

interface IGraphEditorState {
    showPreviewPopUp: boolean;
    message: string;
    isError: boolean;
}

interface IInternalPreviewAreaOptions extends IInspectorOptions {
    popup: boolean;
    original: boolean;
    explorerWidth?: string;
    inspectorWidth?: string;
    embedHostWidth?: string;
}

export class GraphEditor extends React.Component<IGraphEditorProps, IGraphEditorState> {
    private _graphCanvasRef: React.RefObject<GraphCanvasComponent>;
    private _diagramContainerRef: React.RefObject<HTMLDivElement>;
    private _graphCanvas: GraphCanvasComponent;
    private _diagramContainer: HTMLDivElement;

    private _startX: number;
    private _moveInProgress: boolean;

    private _leftWidth = DataStorage.ReadNumber("LeftWidth", 200);
    private _rightWidth = DataStorage.ReadNumber("RightWidth", 300);

    private _previewManager: PreviewManager;
    private _mouseLocationX = 0;
    private _mouseLocationY = 0;
    private _onWidgetKeyUpPointer: any;

    private _previewHost: Nullable<HTMLElement>;
    private _popUpWindow: Window;

    private _externalTextures: RenderTargetWrapper[] = [];

    appendBlock(dataToAppend: NodeRenderGraphBlock | INodeData, recursion = true) {
        return this._graphCanvas.createNodeFromObject(
            dataToAppend instanceof NodeRenderGraphBlock ? TypeLedger.NodeDataBuilder(dataToAppend, this._graphCanvas) : dataToAppend,
            (block: NodeRenderGraphBlock) => {
                if (this.props.globalState.nodeRenderGraph!.attachedBlocks.indexOf(block) === -1) {
                    this.props.globalState.nodeRenderGraph!.attachedBlocks.push(block);
                }

                if (block instanceof NodeRenderGraphOutputBlock) {
                    this.props.globalState.nodeRenderGraph.outputBlock = block;
                }
            },
            recursion
        );
    }

    addValueNode(type: string) {
        const nodeType: NodeRenderGraphBlockConnectionPointTypes = BlockTools.GetConnectionNodeTypeFromString(type);

        const newInputBlock = new NodeRenderGraphInputBlock(type, this.props.globalState.nodeRenderGraph.frameGraph, this.props.globalState.scene, nodeType);
        return this.appendBlock(newInputBlock);
    }

    override componentDidMount() {
        window.addEventListener("wheel", this.onWheel, { passive: false });

        if (this.props.globalState.hostDocument) {
            this._graphCanvas = this._graphCanvasRef.current!;
            this._diagramContainer = this._diagramContainerRef.current!;
            this._previewManager = new PreviewManager(this.props.globalState.hostDocument.getElementById("preview-canvas") as HTMLCanvasElement, this.props.globalState);
            (this.props.globalState as any)._previewManager = this._previewManager;
        }

        if (navigator.userAgent.indexOf("Mobile") !== -1) {
            ((this.props.globalState.hostDocument || document).querySelector(".blocker") as HTMLElement).style.visibility = "visible";
        }

        this.props.globalState.onPopupClosedObservable.addOnce(() => {
            this.componentWillUnmount();
        });

        this.build();
    }

    override componentWillUnmount() {
        window.removeEventListener("wheel", this.onWheel);

        for (const texture of this._externalTextures) {
            texture.dispose();
        }
        this._externalTextures.length = 0;

        if (this.props.globalState.hostDocument) {
            this.props.globalState.hostDocument!.removeEventListener("keyup", this._onWidgetKeyUpPointer, false);
        }

        if (this._previewManager) {
            this._previewManager.dispose();
            this._previewManager = null as any;
        }
    }

    constructor(props: IGraphEditorProps) {
        super(props);

        this.state = {
            showPreviewPopUp: false,
            message: "",
            isError: true,
        };

        this._graphCanvasRef = React.createRef();
        this._diagramContainerRef = React.createRef();

        this.props.globalState.stateManager.onNewBlockRequiredObservable.add((eventData) => {
            let targetX = eventData.targetX;
            let targetY = eventData.targetY;

            if (eventData.needRepositioning) {
                targetX = targetX - this._diagramContainer.offsetLeft;
                targetY = targetY - this._diagramContainer.offsetTop;
            }

            const selectedLink = this._graphCanvas.selectedLink;
            const selectedNode = this._graphCanvas.selectedNodes.length ? this._graphCanvas.selectedNodes[0] : null;
            const newNode = this.emitNewBlock(eventData.type, targetX, targetY);

            if (newNode && eventData.smartAdd) {
                if (selectedLink) {
                    this._graphCanvas.smartAddOverLink(newNode, selectedLink);
                } else if (selectedNode) {
                    this._graphCanvas.smartAddOverNode(newNode, selectedNode);
                }
            }
        });

        this.props.globalState.stateManager.onRebuildRequiredObservable.add(() => {
            if (this.props.globalState.nodeRenderGraph) {
                this.buildRenderGraph();
            }
        });

        this.props.globalState.onResetRequiredObservable.add((isDefault) => {
            if (isDefault) {
                if (this.props.globalState.nodeRenderGraph) {
                    this.buildRenderGraph();
                }
                this.build(true);
            } else {
                this.build();
                if (this.props.globalState.nodeRenderGraph) {
                    this.buildRenderGraph();
                }
            }
        });

        this.props.globalState.onImportFrameObservable.add((source: any) => {
            const frameData = source.editorData.frames[0];

            // create new graph nodes for only blocks from frame (last blocks added)
            this.props.globalState.nodeRenderGraph.attachedBlocks.slice(-frameData.blocks.length).forEach((block: NodeRenderGraphBlock) => {
                this.appendBlock(block);
            });
            this._graphCanvas.addFrame(frameData);
            this.reOrganize(this.props.globalState.nodeRenderGraph.editorData, true);
        });

        this.props.globalState.onZoomToFitRequiredObservable.add(() => {
            this.zoomToFit();
        });

        this.props.globalState.onReOrganizedRequiredObservable.add(() => {
            this.reOrganize();
        });

        this.props.globalState.onGetNodeFromBlock = (block) => {
            return this._graphCanvas.findNodeFromData(block);
        };

        this.props.globalState.hostDocument!.addEventListener("keydown", (evt) => {
            this._graphCanvas.handleKeyDown(
                evt,
                (nodeData) => {
                    this.props.globalState.nodeRenderGraph!.removeBlock(nodeData.data as NodeRenderGraphBlock);
                },
                this._mouseLocationX,
                this._mouseLocationY,
                (nodeData) => {
                    const block = nodeData.data as NodeRenderGraphBlock;
                    const clone = block.clone();

                    if (!clone) {
                        return null;
                    }

                    return this.appendBlock(clone, false);
                },
                this.props.globalState.hostDocument!.querySelector(".diagram-container") as HTMLDivElement
            );
        });

        this.props.globalState.stateManager.onErrorMessageDialogRequiredObservable.add((message: string) => {
            this.setState({ message: message, isError: true });
        });
    }

    zoomToFit() {
        this._graphCanvas.zoomToFit();
    }

    private _setExternalInputs() {
        const nodeRenderGraph = this.props.globalState.nodeRenderGraph;

        let textureIndex = 0;

        const allInputs = nodeRenderGraph.getInputBlocks();
        for (const input of allInputs) {
            if (!input.isExternal) {
                continue;
            }
            if (input.isAnyTexture()) {
                let texture: RenderTargetWrapper;
                if (textureIndex < this._externalTextures.length) {
                    texture = this._externalTextures[textureIndex++];
                } else {
                    texture = this.props.globalState.scene.getEngine().createRenderTargetTexture(
                        { width: 1, height: 1 },
                        {
                            generateMipMaps: false,
                            generateDepthBuffer: false,
                            generateStencilBuffer: false,
                            type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
                            format: Constants.TEXTUREFORMAT_RED,
                            samples: 4,
                            label: `Dummy external texture #${textureIndex} for NRGE`,
                        }
                    );
                    this._externalTextures.push(texture);
                    textureIndex++;
                }
                input.value = texture;
            } else if (input.isCamera()) {
                input.value = this.props.globalState.scene.activeCamera;
            } else if (input.isObjectList()) {
                input.value = { meshes: [], particleSystems: [] };
            }
        }
    }

    buildRenderGraph() {
        if (!this.props.globalState.nodeRenderGraph) {
            return;
        }

        if (!this.props.globalState.noAutoFillExternalInputs) {
            this._setExternalInputs();
        }

        const nodeRenderGraph = this.props.globalState.nodeRenderGraph;

        try {
            nodeRenderGraph.build();
        } catch (err) {
            this.props.globalState.onLogRequiredObservable.notifyObservers(new LogEntry(err, true));
        }
    }

    build(ignoreEditorData = false) {
        let editorData = ignoreEditorData ? null : this.props.globalState.nodeRenderGraph.editorData;
        this._graphCanvas._isLoading = true; // Will help loading large graphes

        if (editorData instanceof Array) {
            editorData = {
                locations: editorData,
            };
        }

        // setup the diagram model
        this._graphCanvas.reset();

        // Load graph of nodes from the render graph
        if (this.props.globalState.nodeRenderGraph) {
            this.loadGraph();
        }

        this.reOrganize(editorData);
    }

    loadGraph() {
        const renderGraph = this.props.globalState.nodeRenderGraph;
        if (renderGraph.outputBlock) {
            this.appendBlock(renderGraph.outputBlock, true);
        }

        renderGraph.attachedBlocks.forEach((n: any) => {
            this.appendBlock(n, true);
        });

        // Links
        renderGraph.attachedBlocks.forEach((n: any) => {
            if (n.inputs.length) {
                const nodeData = this._graphCanvas.findNodeFromData(n);
                for (const input of nodeData.content.inputs) {
                    if (input.isConnected) {
                        this._graphCanvas.connectPorts(input.connectedPort!, input);
                    }
                }
            }
        });
    }

    showWaitScreen() {
        this.props.globalState.hostDocument.querySelector(".wait-screen")?.classList.remove("hidden");
    }

    hideWaitScreen() {
        this.props.globalState.hostDocument.querySelector(".wait-screen")?.classList.add("hidden");
    }

    reOrganize(editorData: Nullable<IEditorData> = null, isImportingAFrame = false) {
        this.showWaitScreen();
        this._graphCanvas._isLoading = true; // Will help loading large graphes

        setTimeout(() => {
            this._graphCanvas.reOrganize(editorData, isImportingAFrame);
            this.hideWaitScreen();
        });
    }

    onPointerDown(evt: React.PointerEvent<HTMLDivElement>) {
        this._startX = evt.clientX;
        this._moveInProgress = true;
        evt.currentTarget.setPointerCapture(evt.pointerId);
    }

    onPointerUp(evt: React.PointerEvent<HTMLDivElement>) {
        this._moveInProgress = false;
        evt.currentTarget.releasePointerCapture(evt.pointerId);
    }

    onWheel = (evt: WheelEvent) => {
        if (this.props.globalState.pointerOverCanvas) {
            return evt.preventDefault();
        }

        if (evt.ctrlKey) {
            return evt.preventDefault();
        }

        if (Math.abs(evt.deltaX) < Math.abs(evt.deltaY)) {
            return;
        }

        const targetElem = evt.currentTarget as HTMLElement;
        const scrollLeftMax = targetElem.scrollWidth - targetElem.offsetWidth;
        if (targetElem.scrollLeft + evt.deltaX < 0 || targetElem.scrollLeft + evt.deltaX > scrollLeftMax) {
            return evt.preventDefault();
        }
    };

    resizeColumns(evt: React.PointerEvent<HTMLDivElement>, forLeft = true) {
        if (!this._moveInProgress) {
            return;
        }

        const deltaX = evt.clientX - this._startX;
        const rootElement = evt.currentTarget.ownerDocument!.getElementById("node-render-graph-editor-graph-root") as HTMLDivElement;

        if (forLeft) {
            this._leftWidth += deltaX;
            this._leftWidth = Math.max(150, Math.min(400, this._leftWidth));
            DataStorage.WriteNumber("LeftWidth", this._leftWidth);
        } else {
            this._rightWidth -= deltaX;
            this._rightWidth = Math.max(250, Math.min(500, this._rightWidth));
            DataStorage.WriteNumber("RightWidth", this._rightWidth);
            rootElement.ownerDocument!.getElementById("preview")!.style.height = this._rightWidth + "px";
        }

        rootElement.style.gridTemplateColumns = this.buildColumnLayout();

        this._startX = evt.clientX;
    }

    buildColumnLayout() {
        return `${this._leftWidth}px 4px calc(100% - ${this._leftWidth + 8 + this._rightWidth}px) 4px ${this._rightWidth}px`;
    }

    emitNewBlock(blockType: string, targetX: number, targetY: number) {
        let newNode: GraphNode;

        let customBlockData: any;

        // Dropped something that is not a node
        if (blockType === "") {
            return;
        }
        if (blockType.indexOf("CustomBlock") > -1) {
            const storageData = localStorage.getItem(blockType);
            if (!storageData) {
                this.props.globalState.stateManager.onErrorMessageDialogRequiredObservable.notifyObservers(`Error loading custom block`);
                return;
            }

            customBlockData = JSON.parse(storageData);
            if (!customBlockData) {
                this.props.globalState.stateManager.onErrorMessageDialogRequiredObservable.notifyObservers(`Error parsing custom block`);
                return;
            }
        } else if (blockType.indexOf("Custom") > -1) {
            const storageData = localStorage.getItem(blockType);
            if (storageData) {
                const frameData = JSON.parse(storageData);

                //edit position before loading.
                const newX = (targetX - this._graphCanvas.x - GraphCanvasComponent.NodeWidth) / this._graphCanvas.zoom;
                const newY = (targetY - this._graphCanvas.y - 20) / this._graphCanvas.zoom;
                const oldX = frameData.editorData.frames[0].x;
                const oldY = frameData.editorData.frames[0].y;
                frameData.editorData.frames[0].x = newX;
                frameData.editorData.frames[0].y = newY;
                for (const location of frameData.editorData.locations) {
                    location.x += newX - oldX;
                    location.y += newY - oldY;
                }

                SerializationTools.AddFrameToRenderGraph(frameData, this.props.globalState, this.props.globalState.nodeRenderGraph);
                this._graphCanvas.frames[this._graphCanvas.frames.length - 1].cleanAccumulation();
                this.forceUpdate();
                return;
            }
        }

        if (blockType.indexOf("Block") === -1) {
            newNode = this.addValueNode(blockType);
        } else {
            const block = BlockTools.GetBlockFromString(blockType, this.props.globalState.nodeRenderGraph.frameGraph, this.props.globalState.scene)!;

            if (block.isUnique) {
                const className = block.getClassName();
                for (const other of this._graphCanvas.getCachedData()) {
                    if (other !== block && other.getClassName() === className) {
                        this.props.globalState.stateManager.onErrorMessageDialogRequiredObservable.notifyObservers(`You can only have one ${className} per graph`);
                        return;
                    }
                }
            }

            block.autoConfigure();
            newNode = this.appendBlock(block);
            newNode.addClassToVisual(block.getClassName());
        }

        // Size exceptions
        let offsetX = GraphCanvasComponent.NodeWidth;
        let offsetY = 20;

        if (blockType === "ElbowBlock" || blockType === "DebugBlock") {
            offsetX = 10;
            offsetY = 10;
        }

        // Drop
        this._graphCanvas.drop(newNode, targetX, targetY, offsetX, offsetY);

        this.forceUpdate();

        return newNode;
    }

    dropNewBlock(event: React.DragEvent<HTMLDivElement>) {
        const data = event.dataTransfer.getData("babylonjs-render-graph-node") as string;

        this.emitNewBlock(data, event.clientX - this._diagramContainer.offsetLeft, event.clientY - this._diagramContainer.offsetTop);
    }

    handlePopUp = () => {
        this.setState({
            showPreviewPopUp: true,
        });
        this.createPopUp();
        this.props.globalState.hostWindow.addEventListener("beforeunload", this.handleClosingPopUp);
    };

    handleClosingPopUp = () => {
        if (this._previewManager) {
            this._previewManager.dispose();
        }
        this._popUpWindow.close();
        this.setState(
            {
                showPreviewPopUp: false,
            },
            () => this.initiatePreviewArea()
        );
    };

    initiatePreviewArea = (canvas: HTMLCanvasElement = this.props.globalState.hostDocument.getElementById("preview-canvas") as HTMLCanvasElement) => {
        this._previewManager = new PreviewManager(canvas, this.props.globalState);
    };

    createPopUp = () => {
        const userOptions = {
            original: true,
            popup: true,
            overlay: false,
            embedMode: false,
            enableClose: true,
            handleResize: true,
            enablePopup: true,
        };
        const options = {
            embedHostWidth: "100%",
            ...userOptions,
        };
        const popUpWindow = this.createPopupWindow("PREVIEW AREA", "_PreviewHostWindow");
        if (popUpWindow) {
            popUpWindow.addEventListener("beforeunload", this.handleClosingPopUp);
            const parentControl = popUpWindow.document.getElementById("node-render-graph-editor-graph-root");
            this.createPreviewMeshControlHost(options, parentControl);
            this.createPreviewHost(options, parentControl);
            if (parentControl) {
                this.fixPopUpStyles(parentControl.ownerDocument!);
                this.initiatePreviewArea(parentControl.ownerDocument!.getElementById("preview-canvas") as HTMLCanvasElement);
            }
        }
    };

    createPopupWindow = (title: string, windowVariableName: string, width = 500, height = 500): Window | null => {
        const windowCreationOptionsList = {
            width: width,
            height: height,
            top: (this.props.globalState.hostWindow.innerHeight - width) / 2 + window.screenY,
            left: (this.props.globalState.hostWindow.innerWidth - height) / 2 + window.screenX,
        };

        const windowCreationOptions = Object.keys(windowCreationOptionsList)
            .map((key) => key + "=" + (windowCreationOptionsList as any)[key])
            .join(",");

        const popupWindow = this.props.globalState.hostWindow.open("", title, windowCreationOptions);
        if (!popupWindow) {
            return null;
        }

        const parentDocument = popupWindow.document;

        parentDocument.title = title;
        parentDocument.body.style.width = "100%";
        parentDocument.body.style.height = "100%";
        parentDocument.body.style.margin = "0";
        parentDocument.body.style.padding = "0";

        const parentControl = parentDocument.createElement("div");
        parentControl.style.width = "100%";
        parentControl.style.height = "100%";
        parentControl.style.margin = "0";
        parentControl.style.padding = "0";
        parentControl.style.display = "grid";
        parentControl.style.gridTemplateRows = "40px auto";
        parentControl.id = "node-render-graph-editor-graph-root";
        parentControl.className = "nrge-right-panel popup";

        popupWindow.document.body.appendChild(parentControl);

        Popup._CopyStyles(this.props.globalState.hostWindow.document, parentDocument);

        (this as any)[windowVariableName] = popupWindow;

        this._popUpWindow = popupWindow;

        return popupWindow;
    };

    createPreviewMeshControlHost = (options: IInternalPreviewAreaOptions, parentControl: Nullable<HTMLElement>) => {
        // Prepare the preview control host
        if (parentControl) {
            const host = parentControl.ownerDocument!.createElement("div");

            host.id = "PreviewMeshControl-host";
            host.style.width = options.embedHostWidth || "auto";

            parentControl.appendChild(host);
            const previewMeshControlComponentHost = React.createElement(PreviewMeshControlComponent, {
                globalState: this.props.globalState,
                togglePreviewAreaComponent: this.handlePopUp,
            });
            ReactDOM.render(previewMeshControlComponentHost, host);
        }
    };

    createPreviewHost = (options: IInternalPreviewAreaOptions, parentControl: Nullable<HTMLElement>) => {
        // Prepare the preview host
        if (parentControl) {
            const host = parentControl.ownerDocument!.createElement("div");

            host.id = "PreviewAreaComponent-host";
            host.style.width = options.embedHostWidth || "auto";
            host.style.height = "100%";
            host.style.overflow = "hidden";
            host.style.display = "grid";
            host.style.gridRow = "2";
            host.style.gridTemplateRows = "auto 40px";
            host.style.gridTemplateRows = "calc(100% - 40px) 40px";

            parentControl.appendChild(host);

            this._previewHost = host;

            if (!options.overlay) {
                this._previewHost.style.position = "relative";
            }
        }

        if (this._previewHost) {
            const previewAreaComponentHost = React.createElement(PreviewAreaComponent, {
                globalState: this.props.globalState,
                width: 200,
            });
            ReactDOM.render(previewAreaComponentHost, this._previewHost);
        }
    };

    fixPopUpStyles = (document: Document) => {
        const previewContainer = document.getElementById("preview");
        if (previewContainer) {
            previewContainer.style.height = "auto";
            previewContainer.style.gridRow = "1";
        }
        const previewConfigBar = document.getElementById("preview-config-bar");
        if (previewConfigBar) {
            previewConfigBar.style.gridRow = "2";
        }
        const newWindowButton = document.getElementById("preview-new-window");
        if (newWindowButton) {
            newWindowButton.style.display = "none";
        }
        const previewMeshBar = document.getElementById("preview-mesh-bar");
        if (previewMeshBar) {
            previewMeshBar.style.gridTemplateColumns = "auto 1fr 40px 40px";
        }
    };

    override render() {
        return (
            <Portal globalState={this.props.globalState}>
                <div
                    id="node-render-graph-editor-graph-root"
                    style={{
                        gridTemplateColumns: this.buildColumnLayout(),
                    }}
                    onMouseMove={(evt) => {
                        this._mouseLocationX = evt.pageX;
                        this._mouseLocationY = evt.pageY;
                    }}
                    onMouseDown={(evt) => {
                        if ((evt.target as HTMLElement).nodeName === "INPUT") {
                            return;
                        }
                        this.props.globalState.lockObject.lock = false;
                    }}
                >
                    {/* Node creation menu */}
                    <NodeListComponent globalState={this.props.globalState} />

                    <div
                        id="leftGrab"
                        onPointerDown={(evt) => this.onPointerDown(evt)}
                        onPointerUp={(evt) => this.onPointerUp(evt)}
                        onPointerMove={(evt) => this.resizeColumns(evt)}
                    ></div>

                    {/* The node graph diagram */}
                    <div
                        className="diagram-container"
                        ref={this._diagramContainerRef}
                        onDrop={(event) => {
                            this.dropNewBlock(event);
                        }}
                        onDragOver={(event) => {
                            event.preventDefault();
                        }}
                    >
                        <GraphCanvasComponent
                            ref={this._graphCanvasRef}
                            stateManager={this.props.globalState.stateManager}
                            onEmitNewNode={(nodeData) => {
                                return this.appendBlock(nodeData.data as NodeRenderGraphBlock);
                            }}
                        />
                    </div>

                    <div
                        id="rightGrab"
                        onPointerDown={(evt) => this.onPointerDown(evt)}
                        onPointerUp={(evt) => this.onPointerUp(evt)}
                        onPointerMove={(evt) => this.resizeColumns(evt, false)}
                    ></div>

                    {/* Property tab */}
                    <div className="nrge-right-panel">
                        <PropertyTabComponent lockObject={this.props.globalState.lockObject} globalState={this.props.globalState} />
                        {!this.state.showPreviewPopUp ? <PreviewMeshControlComponent globalState={this.props.globalState} togglePreviewAreaComponent={this.handlePopUp} /> : null}
                        {!this.state.showPreviewPopUp ? <PreviewAreaComponent globalState={this.props.globalState} width={this._rightWidth} /> : null}
                    </div>

                    <LogComponent globalState={this.props.globalState} />
                </div>
                <MessageDialog message={this.state.message} isError={this.state.isError} onClose={() => this.setState({ message: "" })} />
                <div className="blocker">Node Render Graph Editor runs only on desktop</div>
                <div className="wait-screen hidden">Processing...please wait</div>
            </Portal>
        );
    }
}
