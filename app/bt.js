/*** 
 * 
 * Manages the App window UI and associated logic.
 * NB Runs in context of BT window, not the background BT extension or the helper btContent scripts 
 * 
 ***/

const authorizeButton = document.getElementById('authorize_button');
const signoutButton = document.getElementById('signout_button');

const tipsArray = [
    "Add ':' at the end of a tag to create a new subtag.",
    "Double click on a table row to highlight its open window, if any.",
    "Type ':TODO' after a tag to make the item a TODO in the BT tree.",
    "Create tags like ToRead to keep track of pages you want to come back to.",
    "Remember to Refresh if you've been editing the BrainTool.org file directly. (Also make sure your updates are sync'd to your GDrive.)",
    "Alt-b (aka Option-b) is the BrainTool accelerator key. You can change that in Chrome://extensions",
    "You can tag individual gmails or google docs into the BT tree",
    "BT uses org format for links: [[URL][Link Text]], both can be edited",
    "Note that clicking a link in a BT managed tab will open in a new tab because the BT tab is clamped to that specific web page.",
    "'Pop', 'Hide' and 'Close' support different workflows when filing your tabs",
    "Tag LinkedIn pages into projects to keep track of your contacts",
    "Use the TODO button on a row to toggle between TODO, DONE and ''"
];

var firstUse = true;
function updateSigninStatus(isSignedIn, error=false) {
    // CallBack on GDrive signin state change
    if (error) {
        let msg = "Error Authenticating with Google. Google says:<br/><i>'";
        msg += (error.details) ? error.details : JSON.stringify(error);
        msg += "'</i><br/>If this is a cookie issue be aware that Google uses cookies for authentication.";
        msg += "<br/>Go to chrome://settings/content/cookies and make sure third-party cookies are allowed for accounts.google.com. Then retry.";
        $("#loadingMessage").html(msg);
        return;
    }
    if (isSignedIn) {
        authorizeButton.style.display = 'none';
        signoutButton.style.display = 'block';
        if (firstUse) {
            $("#intro_text").slideUp(750);
            $("#tip").animate({backgroundColor: '#7bb07b'}, 3000).animate({backgroundColor: 'rgba(0,0,0,0)'}, 3000)
            setTimeout(toggleMenu, 16000);
        } else {
            $("#intro_text").hide();
            addTip();
            setTimeout(toggleMenu, 6000);
        }
        findOrCreateBTFile();
    } else {
        $("#auth_screen").show();
        $("#loading").hide();
        authorizeButton.style.display = 'block';
        signoutButton.style.display = 'none';
    }
}

function addTip() {
    // add random entry from the tipsArray
    let indx = Math.floor(Math.random() * tipsArray.length);
    $("#tip").html("<b>Tip:</b> " + tipsArray[indx]);
}

function toggleMenu() {
    // Toggle the visibility of the intro page, auth/de-auth button and open/close icon
    if ($("#auth_screen").is(":visible")) {
        $("#auth_screen").slideUp(750);
        $("#close").show();
        $("#open").hide();
    } else {
        if (firstUse)
            firstUse = false;
        else
            addTip();               // display tip text on subsequent views
        $("#auth_screen").slideDown(750);
        $("#close").hide();
        $("#open").show();
    }
}

var ButtonRowHTML; 
var Tags = new Array();        // track tags for future tab assignment
var BTFileText = "";           // Global container for file text
var OpenedNodes = [];          // attempt to preserve opened state across refresh

function refreshTable() {
    // refresh from file, first clear current state
    $("#refresh").prop("disabled", true);
    $("#refresh").text('...');
    BTFileText = "";
    BTNode.topIndex = 1;

    // Remember window opened state to repopulate later
    // TODO populate from node.opened
    OpenedNodes = [];
    $("tr.opened").each(function() {
        var id = $(this).attr("data-tt-id");
        var node = AllNodes[id];
        OpenedNodes.push(node.title);
    });
    AllNodes = [];
    
    getBTFile();
}


function generateTable() {
    // Generate table from BT Nodes
    var outputHTML = "<table>";
    AllNodes.forEach(function(node) {
        if (!node || !node.hasWebLinks) return;
        outputHTML += node.HTML();
    });
    outputHTML += "</table>";
    return outputHTML;
}


function processBTFile(fileText) {
    // turn the org-mode text into an html table, extract category tags
    BTFileText = fileText;      // store for future editing

    // First clean up from any previous state
    BTNode.topIndex = 1;
    AllNodes = [];
    
    parseBTFile(fileText);

    var table = generateTable(); 
    var tab = $("#content");
    tab.html(table);
    tab.treetable({ expandable: true, initialState: 'expanded', indent: 10,
                    onNodeCollapse: nodeCollapse, onNodeExpand: nodeExpand}, true);

    BTAppNode.generateTags();

    // Let extension know about model
    window.postMessage({ type: 'tags_updated', text: Tags});
    console.count('BT-OUT:tags_updated');
    // only send the core data needed in BTNode, not full AppNode
    var nodes = JSON.stringify(AllNodes.map(appNode => appNode.toBTNode()));    
    window.postMessage({ type: 'nodes_updated', text: nodes});
    console.count('BT-OUT:nodes_updated');

    // initialize ui from any pre-refresh opened state
    var nodeId;
    OpenedNodes.forEach(function(nodeTitle) {
        nodeId = BTNode.findFromTitle(nodeTitle);
        if (!nodeId) return;
        $("tr[data-tt-id='"+nodeId+"']").addClass("opened");
    });

    // set collapsed state as per org data
    AllNodes.forEach(function(node) {
        if (node && node.folded && node.hasWebLinks) // NB no weblinks => not displayed in tree
            tab.treetable("collapseNode", node.id);
    });

    initializeUI();
    refreshRefresh();
}

function refreshRefresh() {
    // set refresh button back on
    $("#refresh").prop("disabled", false); // activate refresh button
    $("#refresh").text("Refresh");
}
    

function initializeUI() {
    //DRY'ing up common event stuff needed whenever the tree is modified
    
    $("table.treetable tr").off('mouseenter');            // remove any previous handlers
    $("table.treetable tr").off('mouseleave');
    $("table.treetable tr").on('mouseenter', null, buttonShow);
    $("table.treetable tr").on('mouseleave', null, buttonHide);  
    $(".elipse").hover(function() {                       // show hover text on summarized nodes
        var thisNodeId = $(this).closest("tr").attr('data-tt-id');
        var htxt = AllNodes[thisNodeId].text;
        $(this).attr('title', htxt);
    });
    // intercept link clicks on bt links
    $("a.btlink").each(function() {
        this.onclick = handleLinkClick;
    });
    
    // double click - show associated window
    $("table.treetable tr").off("dblclick");              // remove any previous handler
    $("table.treetable tr").on("dblclick", function () {
        const nodeId = this.getAttribute("data-tt-id");
        window.postMessage({ 'type' : 'show_node', 'nodeId' : nodeId});
    });
        
    // make rows draggable    
    $("tr").draggable({
        helper: function() {
            buttonHide();
            const clone = $(this).clone();
            return clone;
        },     
        start: dragStart,       // call fn below on start
        handle: "#move",        // use the #move button as handle
        axis: "y",
        scrollSpeed: 10,
        containment: "#content",
        cursor: "move",
        cursorAt: {left: 390},
        opacity: .5,
        revert: "invalid"       // revert when drag ends but not over droppable
    });

    // make rows droppable
    $("tr").droppable({
        drop: function(event, ui) {
            dropNode(event, ui);
        },
        over: function(event, ui) {
            // highlight node a drop would drop into and underline the potential position
            $(this).children('td').first().addClass("dropOver");
            if ($(this).hasClass('branch'))
                $(this).addClass("dropTarget");
            else {
                // nb at top level parent is null so dropping onto $this
                const parentId = $(this).attr('data-tt-parent-id') || $(this).attr('data-tt-id');
                $("tr[data-tt-id='"+parentId+"']").addClass("dropTarget");
            }
        },
        out: function(event, ui) {
            // undo the above
            $(this).children('td').first().removeClass("dropOver");
            if ($(this).hasClass('branch'))
                $(this).removeClass("dropTarget");
            else {
                const parentId = $(this).attr('data-tt-parent-id') || $(this).attr('data-tt-id');
                $("tr[data-tt-id='"+parentId+"']").removeClass("dropTarget");
            }
        }
    });
    
    // Hide loading notice and show refresh button
    $("#loading").hide();
    $("#refresh").show();

    // Copy buttonRow's html for potential later recreation (see below)
    ButtonRowHTML = $("#buttonRow")[0].outerHTML;
}

function reCreateButtonRow() {
    // For some unknown reason very occasionally the buttonRow div gets lost/deleted
    console.log("RECREATING BUTTONROW!!");
    const $ButtonRowHTML = $(ButtonRowHTML);
    $ButtonRowHTML.appendTo($("#dialog"))
}

function dragStart(event, ui) {
    // Called when drag operation is initiated. Set dragged row to be full sized
    const w = $(this).css('width');
    const h = $(this).css('height');
    ui.helper.css('width', w).css('height', h);

    $(this).addClass("dragTarget");

    // collapse open subtree if any
    const nodeId = $(this).attr('data-tt-id');
    if (AllNodes[nodeId].childIds.length) {
        const treeTable = $("#content");
        treeTable.treetable("collapseNode", nodeId);
    }
}
function dropNode(event, ui) {
    // Drop node w class=dragTarget onto node w class=dropTarget in position below class=dropOver
    console.log("dropping");
    const dragNode = $(".dragTarget")[0];
    const dropParent = $(".dropTarget")[0];
    const dropBelow = $($(".dropOver")[0]).parent();

    const dragNodeId = $(dragNode).attr('data-tt-id');
    const dropParentId = $(dropParent).attr('data-tt-id');
    const treeTable = $("#content");

    if (dropParentId) {
        // First set the correct parentage, model then tree
        const nodeIndex = $(dropBelow).index();
        const parentIndex = $(dropParent).index();
        AllNodes[dragNodeId].reparentNode(dropParentId, nodeIndex - parentIndex);
        treeTable.treetable("move", dragNodeId, dropParentId);
        
        // Then move to correct position under parent, update file and update extension for tags
        positionNode(dragNode, dropParent, dropBelow);
        writeBTFile();
        BTAppNode.generateTags();
        window.postMessage({ type: 'tags_updated', text: Tags });
    }
    
    // Clean up
    $(dragNode).removeClass("dragTarget").removeClass("hovered", 750);
    $(dropParent).removeClass("dropTarget");
    $("td").removeClass("dropOver");
}

function positionNode(dragNode, dropParent, dropBelow) {
    // Position dragged node below the dropbelow element under the parent
    // NB treetable does not support this so we need to use this sort method
    console.log("positioning");
    const newPos = $("tr").index(dropBelow);
    const dropParentId = $(dropParent).attr('data-tt-id');
    const treeTable = $("#content");
    const treeParent = treeTable.treetable("node", dropParentId);
    const db = dropBelow[0];
    $(dragNode).attr('data-tt-parent-id', dropParentId);
    function compare(a,b) {
        if (a<b) return -1;
        if (b<a) return 1;
        return 0;
    }
    treeTable.treetable("sortBranch", treeParent,
                        function(a,b) {
                            // Compare based on position except for dragnode 
                            let aa = a.row[0];
                            let bb = b.row[0];
                            if (aa == dragNode){
                                if (bb == db)
                                    return 1;
                                return (compare (newPos, $("tr").index(bb)));
                            }
                            if (bb == dragNode) {
                                if (aa == db)
                                    return -1;
                                return (compare ($("tr").index(aa), newPos));
                            }
                            return (compare ($("tr").index(aa), $("tr").index(bb)));
                        });
}
    

// Handle callbacks on node folding, update backing store
function nodeExpand() {
    console.log('Expanding ', this.id);
    let update = AllNodes[this.id].folded;
    AllNodes[this.id].folded = false;

    // set highlighting based on open child links
    if (!AllNodes[this.id].hasOpenChildren())
        $(this.row).removeClass('opened');

    // Update File 
    if (update) writeBTFile();
}
function nodeCollapse() {
    console.log('Collapsing ', this.id);
    let update = !AllNodes[this.id].folded;
    AllNodes[this.id].folded = true;

    // if any highlighted descendants highlight node on collapse
    if (AllNodes[this.id].hasOpenDescendants())
        $(this.row).addClass('opened');
    
    // Update File 
    if (update) writeBTFile();
}
   

function handleLinkClick(e) {
    var nodeId = $(this).closest("tr").attr('data-tt-id');
    var url = $(this).attr('href');
    console.log("click on :" + $(this).text() + ", nodeId: " + nodeId);
    
    window.postMessage({ 'type': 'link_click', 'nodeId': nodeId, 'url': url });
    console.count('BT-OUT:link_click');
    e.preventDefault();
}

//  Handle relayed messages from Content script
window.addEventListener('message', function(event) {
    // Handle message from Window
    function propogateOpened(parentId) {
        // recursively pass upwards adding opened class if appropriate
        if (!parentId) return;               // terminate recursion
        if ($("tr[data-tt-id='"+parentId+"']").hasClass("collapsed"))
            $("tr[data-tt-id='"+parentId+"']").addClass("opened");
        propogateOpened(AllNodes[parentId].parentId);
    };
    function propogateClosed(parentId) {
        // note not open and recurse to parent
        if (!parentId || AllNodes[parentId].hasOpenDescendants())
            return;                          // terminate recursion
        let parentElt = $("tr[data-tt-id='"+parentId+"']");
        parentElt.removeClass("opened");
        parentElt.addClass("hovered",
                           {duration: 1000,
                            complete: function() {
                                parentElt.removeClass("hovered", 1000);
                            }});
        propogateClosed(AllNodes[parentId].parentId);
    };
    function errorRestoreNodes() {
        // got an unknown node id from background so iniatiate a refresh
        const nodes = JSON.stringify(AllNodes.map(appNode => appNode.toBTNode()));    
        window.postMessage({ type: 'nodes_updated', text: nodes});
        console.count('BT-OUT:nodes_updated');
    }
    let nodeId, parentId;
    if (event.source != window)
        return;
    console.log(`bt.js got ${event.data.type} message:`, event);
    switch (event.data.type) {
    case 'keys':
        processKeys(event.data.client_id, event.data.api_key);
        break;
    case 'new_tab':
        storeTab(event.data.tag, event.data.tab, event.data.note);
        break;
    case 'tab_opened':
        nodeId = event.data.BTNodeId;
        parentId = event.data.BTParentId;
        if (!AllNodes[nodeId]) {
            errorRestoreNodes();
            break;
        }
        AllNodes[nodeId].isOpen = true;
        $("tr[data-tt-id='"+nodeId+"']").addClass("opened");
        $("tr[data-tt-id='"+parentId+"']").addClass("opened");
        propogateOpened(parentId);
        initializeUI();
        break;
    case 'tab_closed':
        nodeId = event.data.BTNodeId;
        if (!AllNodes[nodeId]) {
            errorRestoreNodes();
            break;
        }
        AllNodes[nodeId].isOpen = false;
        parentId = AllNodes[nodeId].parentId;

        // update ui and animate parent to indicate change
        $("tr[data-tt-id='"+nodeId+"']").removeClass("opened", 1000);
        propogateClosed(parentId);
        break;
    case 'error_restore_nodes':
        // sent from background when it thinks node arrays are out of sync
        // send the core data needed in BTNode, not full AppNode
        errorRestoreNodes();
        break;
    }
});

function cleanTitle(text) {
    // clean page title text of things that can screw up BT. Currently []
    return text.replace("[", '').replace("]", '').replace(/[^\x20-\x7E]/g, '');
}

function storeTab(tg, tab, note) {
    // put this tab under storage w given tag
    
    // NB tg may be tag, parent:tag, tag:keyword, parent:tag:keyword
    // where tag may be new, new under parent, or existing but under parent to disambiguate

    // process tag and add new if doesn't exist
    let [tag, parent, keyword, tagPath] = BTNode.processTagString(tg);
    const existingTag = Tags.some(atag => atag.name == tagPath);
    let parentNode;
    if (!existingTag)
    {   // add new node for tag 
        parentNode = addNewTag(tag, parent);
        BTAppNode.generateTags();
    } else {
        let parentNodeId = BTNode.findFromTagPath(tagPath);
        parentNode = AllNodes[parentNodeId];
    }
    
    const url = tab.url;
    const title = cleanTitle(tab.title);
    const newNode = new BTAppNode(`[[${url}][${title}]]`, parentNode.id,
                                  note || "", parentNode.level + 1);
    if (keyword) newNode.keyword = keyword;

    const n = $("table.treetable").treetable("node", parentNode.id);     // find parent treetable node
    $("table.treetable").treetable("loadBranch", n, newNode.HTML());     // and insert new row

    function compare(a,b) {
        if (a<b) return -1;
        if (b<a) return 1;
        return 0;
    }
    $("table.treetable").treetable("sortBranch", n,
                                   function(a, b) {
                                       // sort based on position in parents child array
                                       const aid = a.id;
                                       const bid = b.id;
                                       const pid = AllNodes[aid].parentId;
                                       const ary = AllNodes[pid].childIds;
                                       return (compare(ary.indexOf(aid), ary.indexOf(bid)));
                                   });
    initializeUI();
        
    writeBTFile();                                                       // write out updated file

    // update and let extension know about updated tags list as needed
    if (!existingTag) {
        BTAppNode.generateTags();
        window.postMessage({ type: 'tags_updated', text: Tags });
    }
}

function addNewTag(tag, parent) {
    // New tag - create node and add to tree

    const parentTagId = parent ? BTAppNode.findFromTagPath(parent) : null;
    const parentTagLevel = parentTagId ? AllNodes[parentTagId].level : 0;
    const newNode = new BTAppNode(tag, parentTagId, "", parentTagLevel+1);

    const n = $("table.treetable").treetable("node", parentTagId);                // find parent treetable node
    $("table.treetable").treetable("loadBranch", n || null, newNode.HTML());      // insert into tree
    return newNode;
}



/*** 
 * 
 * Row Operations
 * buttonShow/Hide, Edit Dialog control, Open Tab/Tag(Window), Close, Delete, ToDo
 * 
 ***/

function buttonShow() {
    // Show buttons to perform row operations, triggered on hover
    $(this).addClass("hovered");
    const td = $(this).find(".right")

    if ($("#buttonRow").index() < 0) {
        // Can't figure out how but sometimes after a Drag/drop the element is deleted
        reCreateButtonRow();
    }
    
    $("#buttonRow").detach().appendTo($(td));
    const offset = $(this).offset();
    $("#buttonRow").offset({top: offset.top});
    if ($(this).hasClass("opened")){
        $("#expand").hide();
        $("#collapse").show();
    }
    else {
        $("#expand").show();
        $("#collapse").hide();
    }
    // show expand/collapse if some kids of branch are not open/closed
    if ($(this).hasClass("branch")) {
        const id = this.getAttribute("data-tt-id");
        const notOpenKids = $("tr[data-tt-parent-id='"+id+"']").not(".opened");
        if (notOpenKids && notOpenKids.length)
            $("#expand").show();
        const openKids = $("tr[data-tt-parent-id='"+id+"']").hasClass("opened");
        if (openKids)
            $("#collapse").show();
    }
    $("#buttonRow").show();
}

function buttonHide() {
    // hide button to perform row operations, triggered on exit    
    $(this).removeClass("hovered");
    $("#buttonRow").hide();
    $("#buttonRow").detach().appendTo($("#dialog"));
}

function editRow(e) {
    // position and populate the dialog and open it
    const top = e.clientY;
    $(e.target).closest("tr").addClass('selected');
    const dialog = $("#dialog")[0];

    if ((top + $(dialog).height() + 50) < $(window).height())
        $(dialog).css("top", top+10);
    else
        // position above row to avoid going off bottom of screen
        $(dialog).css("top", top - $(dialog).height() - 50);
    
    if (populateDialog()) {
        dialog.showModal();
    } else {
        $(this).closest("tr").removeClass('selected');
        alert("Error editing here, please update the org file directly and Refresh");
    }
}

$("textarea").change(function() {
    $("#update").prop("disabled", true);
});

$(".editNode").on('change keyup paste', function() {
    $("#update").prop('disabled', false);
});

$("#popup").click(function(e) {
    // click on the backdrop closes the dialog
    if (e.target.tagName === 'DIALOG')
    {
        $("#dialog")[0].close();
        $("tr.selected").removeClass('selected');
        $("#buttonRow").show(100);
    }
});

function dialogClose() {
    $('#dialog')[0].close();
    $("tr.selected").removeClass('selected');
}
    

function selectedNode() {
    // Return the node currently highlighted or selected
    const tr = $("tr.selected")[0] || $("tr.hovered")[0];
    const nodeId = $(tr).attr('data-tt-id');
    return AllNodes[nodeId];
}

function populateDialog() {
    // set up the dialog for use
    const appNode = selectedNode();
    if (!appNode) return false;
    
    const titletxt = appNode.title;
    const txttxt = appNode.text;
    
    $("#title-text").val(titletxt);
    $("#text-text").val(txttxt);
    $("#update").prop("disabled", true);
    return true;
}
    

function openRow() {
    // Open all links under this row in windows per tag

    // First find all AppNodes involved - selected plus children
    const appNode = selectedNode();
    if (!appNode) return;

    const numWins = appNode.countOpenableWindows();
    const numTabs = appNode.countOpenableTabs();

    // Warn if opening lots of stuff
    if ((numWins > 2) || (numTabs > 10))
        if (!confirm(`Open ${numWins} windows and ${numTabs} tabs?`))
            return;
    
    const num_kids = appNode.childIds.length;
    if (num_kids) {
        // container node, handle as such
        openEachWindow(appNode);
    }
    else {
        // individual link, open if not already
        if (!appNode.open) {
            const url = appNode.URL;
            window.postMessage({ 'type': 'link_click', 'nodeId': appNode.id, 'url': url });
            console.count('BT-OUT:link_click');
        }
    }

    // close the dialog
    $("#dialog")[0].close();
    $("tr.selected").removeClass('selected');
}

function openEachWindow(node) {
    // Open all links under this node
    const rowIds = node.childIds.concat(node.id);
    const tabsToOpen = [];
    
    // iterate thru rows and find all links and send msg to extension to open them
    rowIds.forEach(function(id) {
        $("tr[data-tt-id='"+id+"']").find("a").each(function() {
            const url = $(this).attr('href');
            if (url == "#") return;                             // ignore the '...' hover link
            if (AllNodes[id] && !AllNodes[id].isOpen)           // only open if not already
                tabsToOpen.push({'nodeId': id, 'url': url });
        });
    });
    
    if (tabsToOpen.length) {
        window.postMessage({ 'type': 'tag_open', 'parent': node.id, 'data': tabsToOpen});
        console.count('BT-OUT:tag_open');
    }

    // iterate again and recurse for container nodes to each open their windows
    if (node.childIds.length)    
        node.childIds.forEach(function(childId) {
            const child = AllNodes[childId];
            if (child.childIds.length)
                openEachWindow(child);
        });
}

function closeRow() {
    // close this node's tab or window
    const appNode = selectedNode();  
    if (!appNode) return;

    function closeNode(appNode){
        window.postMessage({ 'type': 'close_node', 'nodeId': appNode.id});
        console.count('BT-OUT:close_node');

        // iterate again and recurse for container nodes to each close their windows
        if (appNode.childIds.length)   
            appNode.childIds.forEach(function(childId) {
                const child = AllNodes[childId];
                if (child.childIds.length)
                    closeNode(child);
        });
        
    }
    closeNode(appNode);
}

function escapeRegExp(string) {
    // stolen from https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function deleteRow() {
    // Delete selected node/row.
    buttonHide();
    const appNode = selectedNode();
    if (!appNode) return false;
    const kids = appNode.childIds.length && appNode.isTag();         // Tag determines non link kids

    // If children nodes ask for confirmation
    if (!kids || confirm('Delete all?')) {
        $("table.treetable").treetable("removeNode", appNode.id);    // Remove from UI and treetable
        $("#dialog")[0].close();
        deleteNode(appNode.id);
    }   
}

function deleteNode(id) {
    //delete node and clean up
    id = parseInt(id);           // could be string value
    const node = AllNodes[id];
    if (!node) return;
    BTNode.deleteNode(id);       // delete from model. NB handles recusion to children
    
    // Update parent display
    const parent = AllNodes[node.parentId];
    if (parent) {
        const openKids = $("tr[data-tt-parent-id='"+parent.id+"']").hasClass("opened");
        if (!openKids)
            $("tr[data-tt-id='"+parent.id+"']").removeClass("opened");
    }
    
    // message to update BT background model
    window.postMessage({ type: 'node_deleted', nodeId: id });
    console.count('BT-OUT:node_deleted');

    // Remove from Tags and update extension
    BTAppNode.generateTags();
    window.postMessage({ type: 'tags_updated', text: Tags});
    console.count('BT-OUT:tags_updated');
    
    // Update File 
    writeBTFile();
}


function updateRow() {
    // Update this node/row after edit.
    const tr = $("tr.selected")[0] || $("tr.hovered")[0];
    const node = selectedNode();
    if (!node) return;

    // Update Model
    node.title = $("#title-text").val();
    node.text = $("#text-text").val();
    
    // Update ui
    $(tr).find("span.btTitle").html(node.displayTitle());
    $(tr).find("span.btText").html(node.displayText());

    // Update File 
    writeBTFile();

    // Update extension
    BTAppNode.generateTags();
    window.postMessage({ type: 'tags_updated', text: Tags});
    console.count('BT-OUT:tags_updated');

    // reset ui
    $("#dialog")[0].close();
    $("tr.selected").removeClass('selected');
    initializeUI();
}

function toDo() {
    // iterate todo state of selected node/row (TODO -> DONE -> '').
    const tr = $("tr.selected")[0] || $("tr.hovered")[0];
    const appNode = selectedNode();
    if (!appNode) return false;

    appNode.iterateKeyword()    // ask node to update

    // Update ui and file
    $(tr).find("span.btTitle").html(appNode.displayTitle());
    initializeUI();
    writeBTFile();
}


function generateOrgFile() {
    // iterate thru nodes to do the work
    let orgText = metaPropertiesToString(AllNodes.metaProperties);
    
    AllNodes.forEach(function (node) {
        // start at top level nodes and recurse, cos child nodes don't necessarily follow parent nodes in array
        if (node && (node.level == 1))
            orgText += node.orgTextwChildren() + "\n";
    });
    return orgText.slice(0, -1);                                      // take off final \n
}

